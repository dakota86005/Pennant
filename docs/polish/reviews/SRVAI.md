## SRVAI deep hunt: AI, the upstream chat, providers, storylines, the Morning Report reader, the dashboard and front-office memory

**Base:** worktree `(scratch)` (detached at e6cdd08), with `node_modules` symlinked from the main checkout.

**Constraints kept:** nothing was committed, no real provider or key was used, no app was launched and no UI tests were run. Every provider call was a stub through a mocked `server/aiSdk.ts`. `npx tsc --noEmit` is clean for the new file.

**Proving tests:** `(scratch)`. Run it with `npx vitest run tests/zz_srvai_proofs.test.ts`; 7 tests pass. They assert the bugs as they are now, so each assertion flips once its bug is fixed.

**Not re-reported:** MACKIT-01, SRVINFRA-07/-09/-26/-27/-34, B-14, B-49 and FO-07. The findings that extend them are marked.

### Findings, most severe first

**SRVAI-01 · H · PROVEN · bug: The Staff room's 400k-character limit on what it resends never works, so conversations grow without limit and then fail every question.**
- `markCachePoint` (`server/chat.ts:742-752`) turns the question's string content into a `[{type:'text'}]` array. `stripCachePoints` (`:726-731`) leaves it as an array, and that is the form `saveContext` stores (`:972-975`).
- `trimTranscript` (`:688-698`) can only cut just before a user message whose content is a string. A stored transcript has none, so it finds no place to cut, breaks out, and the whole transcript is resent (`:958`).
- **Proof:** test SRVAI-01. After 7 questions the stored transcript is 540k characters, `trimTranscript` returns it whole, and the 7th request sent the model more than 400k characters.
- **Trigger:** a long Staff room conversation that calls tools; each tool result can be up to 60k characters (`cap`, `:134`).
- **Effect:** cost grows with every question (cache entries expire after 5 minutes and are rewritten at 1.25×). Past the model's context window (200k tokens on Haiku 4.5, OpenAI and Gemini; 1M on Opus/Sonnet 5), every question fails until the GM starts over.
- **Fix:** have `trimTranscript` also cut before a user message made only of text blocks (no `tool_result`), or keep questions as strings when stored.

**SRVAI-02 · H · CONFIRMED · doctrine: Every AI surface can fetch the postseason odds and the buy/hold/sell posture, against D-060.**
- The shared `TOOLS` (`server/chat.ts:319-331`) offer `get_dashboard` ("the buy/hold/sell read with the postseason odds... 'should we buy or sell'"). That serves `deadline: deadlineRead(orgId)` (`server/dashboard.ts:383`).
- The Mac AI desk removes the club's value of a win for D-060 (`server/ai.ts:446`, `winValues:false`), yet passes the same `TOOLS` (`:325`), so the odds come back through a tool call. The Staff room has no guard at all.
- **Proof:** test SRVAI-05 shows the tool and its source.
- **Trigger:** asking the Staff room or the AI desk "should we buy or sell?"
- **Fix:** take `deadline` and `playoffs` out of what the tools can reach (a D-060-clean dashboard tool), and add a boundary test on `TOOLS`. Related to the owner's "no odds/posture headline" rule.

**SRVAI-03 · M · PROVEN · bug: The Mac AI desk keeps running, and paying, after the app has given up.**
- `askTheDesk` (`server/ai.ts:310-337`) passes no `signal`. `/v2/views/:org/trades/ask` (`:502-509`) never listens for the request closing, and it has no time limit and no one-at-a-time hold (the Staff room has both).
- **Proof:** test SRVAI-06. The client aborts after 250 ms with fewer than 5 model calls made, and the loop still makes all 12 calls.
- **Effect (extends MACKIT-01):** every answer the app abandons after its 60-second wait still runs up to 12 paid turns, and each Try Again starts another full loop in parallel.
- **Fix:** an `AbortController` tied to `res.on('close')` plus a time limit, passed as `signal`; hold one ask per club as the Staff room does.

**SRVAI-04 · M · PROVEN · bug: A tool loop that runs out of turns returns an empty answer as a success.**
- All four loops (`server/providers.ts:563-619` OpenAI/Ollama/Zen, `:757-827` Gemini, `:951-985` the Anthropic desk loop, `server/chat.ts:842-891`) run 12 turns. They execute the last turn's tools, throw those results away, and return `answer:''` with `refused:false`.
- **Proof:** test SRVAI-02 — 12 model calls, 12 tools run, result `{answer:'', refused:false}`.
- **Effect:** the trade desk serves an empty reply. In the Staff room the stored transcript ends on tool results, so the next question (on Anthropic with thinking on) may also hit a 400 because the thinking was stripped.
- **Fix:** on the last turn, call again without tools (or with "answer now"); otherwise say plainly that it ran out of lookups.

**SRVAI-05 · M · PROVEN · bug: An answer cut off by the token limit is served and stored as if complete.**
- `anthropicToolLoop` ignores `stop_reason: 'max_tokens'` (`server/providers.ts:960`; its limit is 4000). The Staff room loop ignores it too (`server/chat.ts:859-865`), and its 8000-token limit is shared with adaptive thinking.
- OpenAI does not check `finish_reason 'length'` (`:598`), and Gemini treats `MAX_TOKENS` as fine (`:806`). By contrast, `complete()` throws `TruncatedError`.
- **Proof:** test SRVAI-03 — the desk loop returns the half sentence "He is worth about $4M to $" as complete, and the Staff room sends `text` then `done`.
- **Fix:** treat a truncation as failed or incomplete in all four loops. Stream with a higher limit.

**SRVAI-06 · M · PROVEN · bug: On the Mac, from the 22nd question on, the Staff room no longer resumes its stored tool results.**
- The kept conversation is capped at 40 messages (`server/aiSurfacesService.ts:48`, `:110`). The stored context's visible thread is longer, so `continuesThread` (`server/chat.ts:701-704`) answers false from then on and every question rebuilds from plain text.
- **Effect:** the "remember what it read" feature (`server/chat.ts:655-666`) silently stops working, which is the failure that design was meant to prevent.
- **Proof:** test SRVAI-04 — questions 2 to 21 resume, 22 to 25 do not.
- **Fix:** compare the stored thread's tail against the conversation file (an overlap match), or cap both at the same number.

**SRVAI-07 · M · CONFIRMED · doctrine: The Storylines prompt asks the model for promotion verdicts and gives none of the briefing's guardrails.**
- The prompt (`server/storylines.ts:260-265`) says "Be opinionated...: who is earning a promotion". Its context carries the farm's `promotionDirection` codes (`mlb_ready_discussion`, ...) and contract value figures.
- It lacks the briefing's farm rules ("never a call-up"; only a AAA player may be called a call-up candidate; do not rank), `VALUE_FIGURES_NOTE` (null means not known; no number of its own; never advice), and the strict data rules (`server/ai.ts:124-143`).
- **Effect:** this breaks D-001, D-003, D-018 and D-044.
- **Fix:** share the briefing's farm, contract and value rules with Storylines, and drop "who is earning a promotion".

**SRVAI-08 · M · CONFIRMED · bug: The assistants' tools default to the first human club in the save, not the club the app follows.**
- `defaultOrgId()` (`server/chat.ts:525-534`, `human_team = 1 LIMIT 1`, no order and no level filter) drives `get_standings` always (`:431`), and the defaults for `get_franchise_history`, `get_dashboard`, `get_contracts`, `get_free_agents` and `get_roster_crunch` (`:414`, `:482-506`). It is also used for the React `/chat` route (`:1075`; an `orgId:null` becomes team 0).
- **Effect (extends SRVINFRA-26):** with several human clubs, or an affiliate marked human, the Staff room reads another club's standings and contracts.
- **Fix:** default to the asking club (pass `team` into `runTool`), else `currentOrganization()`.

**SRVAI-09 · M · CONFIRMED · bug: The prospects tool tells the model the list is ranked when it is alphabetical.**
- The tool description (`server/chat.ts:289-296`) says "ranked by promotion signal, with the reasoning behind each ranking". `computeProspects` sorts by name and has had no signal since D-044 (`server/org.ts:738-752`).
- **Effect:** the model will name the first players alphabetically as the "top prospects", which is the bug `server/ai.ts:93-96` describes having fixed.
- **Fix:** reword the description ("listed by name; no ranking; read farm attention for decisions").

**SRVAI-10 · M · CONFIRMED · robustness: AI generations and the key check have no real time limit and cannot be cancelled.**
- No SDK client sets `timeout` or `maxRetries` (`server/providers.ts:135`, `:178-179`, `:415`; `server/ai.ts:52`). The SDK defaults are 10 minutes, retried twice on timeout, so a stuck call runs for up to 30 minutes.
- Briefing and storyline jobs (`server/jobs.ts:53-100`) have no time limit and no Stop; a later POST answers `started:false` until the call ends.
- The key check races a 15-second timer but leaves `validateKey` running (`server/ai.ts:585-590`).
- A slow local Ollama model ends as "Could not reach the service. Check your connection" (`server/providers.ts:898`).
- **Fix:** explicit `timeout`, `maxRetries: 0`, an AbortSignal and a job time limit.

**SRVAI-11 · M · SUSPECTED · doctrine: On Ollama, the system prompt with its guardrails can be silently cut.**
- Ollama is reached through its OpenAI-compatible endpoint (`server/providers.ts:250-254`, `:837`), which uses the model's default context window; that endpoint cannot set it.
- The Staff room's system prompt, tool schemas and 60k-character tool results are far larger. Ollama truncates from the front, so the D-001 and D-018 instructions are the first to go.
- **Fix:** use Ollama's native API with `num_ctx`, or cap the context for Ollama and say so.

**SRVAI-12 · M · SUSPECTED · bug: The Staff room rewrites its history, which preserved-thinking checks may refuse.**
- It strips thinking blocks before storing (`server/chat.ts:762-770`), cuts prefixes (`:688-698`), turns strings into text blocks (`:742-752`) and rebuilds rooms each turn (`:995-1003`).
- Per the claude-api skill, on Claude Opus 5.5 and Sonnet 5.5, accounts created on or after 2026-08-31 get a 400 on edited history; the rule is to keep the history append-only.
- The app's model lists stop at `claude-opus-5`, `claude-sonnet-5` and `claude-haiku-4-5` (`server/models.ts:39-43`, `server/providers.ts:449-455`). The current models are `claude-opus-5-5`, `claude-sonnet-5-5` and `claude-haiku-5-5`.
- **Fix:** run the skill's preserved-thinking check (`/claude-api preserved-thinking-migration`) before offering the 5.5 models; refresh the fallback list.

**SRVAI-13 · L · CONFIRMED · bug (extends MACKIT-01): On Claude Opus 5.5 and Sonnet 5.5 the Staff room goes silent between tool calls.**
- On those models, text written between tool calls comes back as empty thinking blocks unless `display:'updates'` is set (claude-api skill).
- `runToolLoop` streams only `text` events (`server/chat.ts:854-857`), so nothing at all is written between lookups, adding to the 60-second silence.
- **Fix:** an SSE heartbeat (`: keep-alive` every 15 s) and `display` set explicitly.

**SRVAI-14 · L · CONFIRMED · bug: A refusal from OpenAI, Gemini, Zen or Ollama is never said in the Staff room.**
- Those loops return `{refused:true}` without an `error` event (`server/providers.ts:598`, `:808`). A one-to-one answer ignores `refused` (`server/chat.ts:965-976`), so it stores the partial answer and sends `done`.
- **Fix:** send the declined event in `answerStaff` when `refused` is true.

**SRVAI-15 · L · CONFIRMED · doctrine: An unknown games-back figure is told to the model as "leading the division".**
- `standing()` (`server/staff.ts:443-445`) does `gb ?? 0`, then turns that into "leading the division" for every staff voice. The same pattern feeds AI context in `server/farmOperations.ts:1301` (`age: Number(p.age ?? 0)`). Both break D-018.
- **Fix:** omit the clause, or say "not known".

**SRVAI-16 · L · CONFIRMED · robustness: The AI context and the dashboard assume columns that other modules check for first.**
- `allstar_team` is assumed in `server/ai.ts:75`, `server/storylines.ts:52` and `server/dashboard.ts:148`; `server/aiSurfacesService.ts:166` checks it.
- `game_type` is assumed in `server/dashboard.ts:43`; `server/probableStarters.ts:37` checks it.
- If an export lacks either column, the briefing and storylines fail outright. `contracts` is wrapped in a try in the briefing but not in storylines (`server/storylines.ts:117`).
- Also, "recent results" do not filter `game_type` (`server/dashboard.ts:157-166`, `:200-207`; `server/storylines.ts:58-71`), so spring games are read as season form in March.
- **Fix:** check columns with `tableColumns`, and filter `COALESCE(game_type,0)=0`.

**SRVAI-17 · L · CONFIRMED · security: Part of the API key is written to disk in plain text.**
- `unusable-models.json` stores the key's length plus its last **6** characters (`server/unusable.ts:39`). The codebase's own rule is "at most the last four characters" (`server/ai.ts:547`), and the Keychain design means the server keeps no key on disk.
- **Fix:** use a salted SHA-256 fingerprint.

**SRVAI-18 · L · CONFIRMED · outdated: The default Gemini model is one the code itself says Google refuses.**
- `DEFAULT_MODEL.gemini = 'gemini-2.5-pro'` and the fallback list (`server/providers.ts:452`; `server/models.ts:48-51`) are the models the comments at `:336-343` describe as returning 404 for new keys. Every new Gemini user's first call fails and then shows a "could not be used on your key" notice about a model they never chose.
- The emergency fallback is a `-preview` id (`:344`).
- **Fix:** default to `GEMINI_FALLBACK` and refresh the list.

**SRVAI-19 · L · CONFIRMED · perf: Every Staff room question asks Anthropic for its model list again when that list fails.**
- `supportsAdaptiveThinking` runs on every question (`server/chat.ts:945-946`). `listModels` does not cache a failure (`server/models.ts:136-140`), so every question pays a models call, with retries, before the first word.
- **Fix:** cache the fallback result for a short time.

**SRVAI-20 · L · CONFIRMED · bug: A key check against OpenCode Zen reports "accepted it" when the gateway is down or rate-limited.**
- `validateKey` swallows every error that is not an outright key rejection (`server/providers.ts:297-307`), so `/v2/ai/keys/check` answers "works" (`server/ai.ts:591`).
- **Fix:** return "unchecked" for those errors in the check route.

**SRVAI-21 · L · CONFIRMED · bug: The React chat route names Anthropic even when another provider has no key.**
- `/api/chat` answers a missing key with the hard-coded `NO_KEY_MESSAGE` (`server/chat.ts:113-114`, `:1073`, `:1047`), not `noKeyMessage(provider)`.

**SRVAI-22 · L · CONFIRMED · cost: Turning on "write after each import" pays for two generations on every export.**
- With `autoGenerateAfterImport` on (`server/api.ts:188-212`), every export, including day-by-day sim exports, starts a briefing and a storyline set. There is no "same game date, skip" check and no daily limit.
- Combined with the Opus default (SRVINFRA-27), this is the costliest path in the app.
- **Fix:** skip when the game date is unchanged since the last write.

**SRVAI-23 · L · SUSPECTED · bug: Gemini tool-call ids repeat from one question to the next.**
- Generated Gemini ids `gemini-<turn>-<n>` restart with every question (`server/providers.ts:799`), so a stored transcript holds duplicates. After switching the chat to Anthropic these may be refused (uniqueness of tool_use ids not confirmed).
- **Fix:** use a random id.

### Riskiest areas needing a deeper look or better tests
1. **The Staff room transcript machinery** (`server/chat.ts:655-1051`: storing, resuming, trimming, cache points, stripping thinking). The existing `tests/chat.test.ts` builds transcripts by hand with string questions, so it never tests the shape the app actually stores. That is how SRVAI-01 passed. It also needs a provider-switch test and a preserved-thinking check for the 5.5 models.
2. **No AI loop has a hard limit:** turns, tokens, time, abort or concurrency (SRVAI-03, -04, -05, -10). A test should drive each loop with a stub that never stops asking for tools, never answers, or is truncated.
3. **What the tools let the model read.** `TOOLS` reaches every legacy React route, the posture/odds dashboard among them, and has no boundary test against D-060 or D-018. Add a test that lists every route a tool can call and greps each payload for `deadline`, `odds`, `posture`, `players_value` and unknown-to-zero coalescing.

### Upstream-era code to retire or rewrite
- **`get_dashboard` and the React `/api/dashboard` it calls** (`server/dashboard.ts:133-404`). It is posture/odds plus a second, unguarded copy of the recent games, hot/cold and streaks. The Mac app's Morning Report has replaced it, and it is the D-060 leak in SRVAI-02.
- **The React AI routes now duplicated by `/v2`:** `/api/chat`, `/chat-history` (with its dead `KEEP_TURNS=1000` next to the Mac's 40), `/trade/ai-eval`, `/trade/ai-reply`, `/briefing/:orgId`, `/storylines/:orgId`. They are mounted in the sidecar (`server/api.ts:90-106`), are reachable by SRVINFRA-07, apply only some of the newer hardening (no `withoutKey`; raw errors logged at `server/ai.ts:471`, `:493`), and the busy holds don't cover them.
- **`callOwnApi`, the tools calling the server's own API over HTTP** (`server/chat.ts:122-131`). It has no timeout, assumes `127.0.0.1` (it breaks when bound to `::1`), and depends on `OOTP_FO_PORT`. Calling the services directly, as `get_trading_block` already does, would remove the extra hop and let tool results be cached per import.

`server/morningReport.ts` and `server/frontOfficeMemory.ts` were read in full; nothing serious turned up.
