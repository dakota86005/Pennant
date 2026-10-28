# SRVSTATS deep hunt: the upstream data layer (read-only)

**Worktree:** `(scratch)` (detached at e6cdd08, `node_modules` symlinked). Nothing was committed or pushed. No app was launched. No real data, Keychain, OOTP files or UI tests were touched.

**Proving tests.** Each test asserts the *correct* behaviour, so a failure is the bug. Run them from the worktree:
`npx vitest run tests/deephuntSrvstats.test.ts tests/deephuntSrvstatsFog.test.ts tests/deephuntSrvstatsSearch.test.ts`
- `tests/deephuntSrvstats.test.ts`: 9 failing tests (injury order, leaders ×2, ERA+ ×2, trade line, game plan, rotation, FIP) and 1 passing.
- `tests/deephuntSrvstatsFog.test.ts`: 1 failing test (the fog breach) and 1 passing control.
- `tests/deephuntSrvstatsSearch.test.ts`: 2 failing tests (Player Search scale).

I re-checked these against the B-list and the SRVINFRA, MACUI and MACKIT reports. The ones already listed there are not repeated (null coalesced to 0 is B-02, decimal innings are B-09, batted-ball caches are SRVINFRA-05).

## Findings, most severe first

**SRVSTATS-01 · H · PROVEN · doctrine: the Trade Desk is handed the main table's fielding grades, which are true ratings in a "real ratings" export, not our scouts' grades**
- **Evidence:**
  - `server/trade.ts:665` (`fielding: glovesLine(id)`) calls `gloves.ts:100-106`, which runs `SELECT * FROM players_fielding` directly.
  - It skips `scoutedGloves` and `ratingFrom` (D-067) and `ratingsWithheld()`.
  - `tradeContext` is the AI desk's brief.
  - The boundary test cannot see this: `tests/evidenceBoundary.test.ts` guards only the files it lists and only direct `gloves(` calls. `trade.ts` is not listed, and `glovesLine` hides the call anyway.
- **Proof:** `deephuntSrvstatsFog.test.ts`. Our scouts' row is 75, the main table is 41, mode `real`. `scoutedGloves` says 75. `glovesLine` and `tradeContext(...).weGive[0].fielding` both say `"41 at SS"`.
- **Trigger:** any export that carries `players_scouted_ratings`, or true ratings in the main tables, or "no ratings" mode.
- **Fix:** have `glovesLine` read `scoutedGloves(id)`, make `gloves()` private to `scoutedEvidence.ts`, and add `trade.ts` and `gloves.ts` callers to the boundary test.

**SRVSTATS-02 · H · PROVEN · bug: League Leaders drop everyone not on a club in the league today**
- **Evidence:**
  - `rosterops.ts:219` and `:256` join `teams t ON t.team_id = p.team_id`, the player's *current* club, then filter `t.league_id = ?`.
  - So a man optioned to AAA (the affiliate's own league), released, retired mid-season or traded to another league loses his whole major-league season.
  - The `team` column shows his current club's abbreviation, not the club he earned the line with.
- **Proof:** a 40-HR player who was optioned is missing (`[10, 9804]` lacks `9801`). The same player released is also missing.
- **Fix:** filter on `s.league_id` and `s.level_id = 1`, and take the club from `s.team_id`. Related to B-02 (same view, different cause).

**SRVSTATS-03 · M · PROVEN · perf/bug: a Player Search sorted by a stat is quadratic, runs on the server's thread, and fails past 32,766 matches**
- **Evidence:**
  - The Mac asks with `level:'all'` (`scoutingViews.ts:188`).
  - A stat sort computes *every* match (`league.ts:392` and the sort at `:500`).
  - Each stat row looks its player up with `rows.find` (`:422`), which is O(n²).
  - Every id is bound as one SQL variable (`:403`, `:416`, and the stints query). better-sqlite3's limit is 32,766, which I measured.
  - `leagueViewService.ts:247` runs it in process and calls it "a bounded query". It isn't.
- **Proof:** 20,000 matches take 3,096 ms. 33,000 matches throw `too many SQL variables`.
- **Trigger:** any stat-column sort. It fails outright in a save with school competitions or many rostered amateurs.
- **Fix:** use a `Map` for the lookup and a temp table or `json_each` for the ids. Better, rank in SQL or from a per-import table.

**SRVSTATS-04 · M · PROVEN · bug: Rosters and the Trade Desk compute FIP without hit batters, against a league constant that includes them**
- **Evidence:** the pitching SUMs in `roster.ts:280-283` and `trade.ts:600-602` omit `hp`. `computePitching` reads `g('hp')` as 0, while `lgFIPRaw` (`stats.ts:200`) counts it.
- **Proof:** a pitcher with 9 HBP in 60 IP has FIP 3.02 on Rosters and 3.47 on the pitching staff page.
- **Fix:** add `SUM(hp) AS hp`. Better, one shared season-line reader (see the riskiest areas below).

**SRVSTATS-05 · M · PROVEN · bug: a 0.00 ERA has no ERA+, so the best reliever sorts last and reads as "unknown" form**
- **Evidence:**
  - `stats.ts:293` returns `eraPlus = null` when `era > 0` is false.
  - The bullpen sort `pitching.ts:321` (`?? 0`) puts him last.
  - `form.ts:120` gives verdict `unknown`, which Contracts shows.
  - The trading block prints no ERA+.
- **Proof:** a line of 30 IP and 0 ER gives `eraPlus` null and form verdict `'unknown'`.
- **Fix:** represent ERA+ as unbounded or capped and say so. Sort nulls by a stated rule, never as 0.

**SRVSTATS-06 · M · PROVEN · bug: the Trade Desk's season line adds his AAA and MLB lines together and measures the total against his current level**
- **Evidence:** `trade.ts:607-611` has no `level_id` filter, uses the baseline of his current league and level, and passes `teamId` 0. That is exactly the fault `roster.ts:179-185` documents.
- **Proof:** 400 AAA PA plus 40 MLB PA gives `seasonLine.pa = 440`.
- **Fix:** group by level and league and label each line (as `tradingblock.linesFor` does).

**SRVSTATS-07 · M · PROVEN · bug: the Game Plan's "our hitters against this club" counts at-bats against pitchers by the club they pitch for *now***
- **Evidence:** `gameplan.ts:111-115` joins `players op ON op.player_id = a.opponent_player_id WHERE op.team_id = ?`. A pitcher traded to the opponent brings his whole history with him, and one traded away takes his.
- **Proof:** 8 at-bats against an arm who has since joined the opponent are returned as history against that club.
- **Fix:** take the opponent from the game (`games.home_team/away_team` of `a.game_id`). Related to B-12, different cause.

**SRVSTATS-08 · M · PROVEN · bug: the pitching staff's rotation drops anyone OOTP projects to start whose role isn't 11**
- **Evidence:** `pitching.ts:264`. `starters` is `role === 11` only, and the projected order is filtered through it.
- **Effect:** an opener or a stretched-out reliever vanishes from the rotation, the slot numbers skip (1, 2, 3, 5), and he shows in the bullpen. Meanwhile `probableStarters` names him as tonight's starter.
- **Proof:** a role-12 pitcher in `starter_1` is absent from `rotation` (`[14]`).
- **Fix:** build the rotation from the projected ids first, whatever the role.

**SRVSTATS-09 · M · PROVEN · bug: the player card's injury history is ordered as unpadded text, so the newest injury can be cut off**
- **Evidence:** `player.ts:297` runs `ORDER BY date DESC LIMIT 12` on OOTP dates. `presentation/player/dossier.ts:1023` keeps that order as the row's date sort.
- **Proof:** with 12 September injuries plus one on 10-5, the first row is `2030-9-9` and the October injury is gone.
- **Fix:** `ORDER BY ${DATE_KEY('date')} DESC`.

**SRVSTATS-10 · M · CONFIRMED · bug: staff notes and the watchlist are filed under the save's display name**
- **Evidence:** `history.ts:2051-2088` and `:2025-2035` use `save_name = currentSaveName()`, the config name, or `'unknown'`. D-064 moved rating history off names precisely because OOTP calls every new league "New Game".
- **Effect:** player 1234's notes in one "New Game" appear on a different player 1234 in another save. With SRVINFRA-01's ordering, they also follow a switch before the import lands. The Mac reads them through `playerViewService.ts:238`.
- **Fix:** key by `currentHistoryKey()` or the save id, with a one-time migration. Related to SRVINFRA-09.

**SRVSTATS-11 · M · CONFIRMED (code) / SUSPECTED (impact) · doctrine: Quick Open indexes players OOTP doesn't show yet**
- **Evidence:** `search.ts:120-122` filters only on `retired`. The draft board deliberately gates on `show_draft_pool` and `hidden = 0` (`rosterops.ts:560-566`, `:775`): "listing them here invented a scouting report out of thin air."
- **Effect:** search and the player window (`computePlayerDossier`, which has no gate) show the unpublished class with our scouts' grades.
- **Fix:** exclude `hidden = 1`, and exclude draft-eligible amateurs while the pool isn't visible. Refuse them in the dossier too.

**SRVSTATS-12 · M · CONFIRMED · bug: "this season" means two different things**
- **Evidence:** ten upstream readers take `MAX(year)` from the career tables, ignoring league and level: `roster.ts:158`, `lineup.ts:531`, `pitching.ts:164`, `league.ts:296`, `form.ts:93-100`, `tradingblock.ts:86`, `trade.ts:745`, `twoway.ts:49`, `org.ts:268` and `:287`. The newer code uses `leagues.season_year` (`resultsEvidence.currentSeason`, `valuation.seasonYear`, Leaders, Player Value).
- **Effect:** after OOTP rolls the season over and before games are played, Rosters, Lineup's "This Season" order and form show last year's lines unlabelled, while Leaders and values are on the new season.
- **Fix:** one `currentSeason(leagueId)`, and label any fallback. Related to B-26.

**SRVSTATS-13 · M · CONFIRMED · doctrine: the lineup's "This Season" order counts a man with no plate appearances as exactly league average**
- **Evidence:** `lineup.ts:588` returns `if (rate === null || pa <= 0) return 100`. The comment calls this "the honest reading of no evidence", which D-018 forbids. The Mac offers this order (`presentation/clubhouse/lineup.ts:69`).
- **Effect:** an ungraded backfill or a call-up with no line can bat cleanup.
- **Fix:** with no line, keep him off the ranking, as the talent sort already does.

**SRVSTATS-14 · M · CONFIRMED (code) / SUSPECTED (size) · perf: the wire reads the whole injury and trade history on every gather**
- **Evidence:** `leagueWire.ts:297` (`SELECT * FROM trade_history`) and `:320` (all of `players_injury_history`), then `playersNamed` over every id ever named, before the season filter in JS. It runs once per import per club slot (up to 4).
- **Trigger:** long-history saves (the 1930 USBL).
- **Fix:** filter by the year prefix of `date` in SQL first.

**SRVSTATS-15 · M · SUSPECTED · perf: Player Development's whole prospect pass is recomputed per context per need**
- **Evidence:** `mlbOperations.ts:71` leads to `mlbAssignmentAssessments`, and each call runs `computeProspects(orgId)` (`org.ts:780`, `:879`): league-wide level baselines and every minor leaguer's evaluation. `mlbResponses.ts:1195` calls it once per evaluated context (up to 2) for each need, and `mlbEvidence.ts:634` adds another.
- **Trigger:** every MLB report build.
- **Fix:** memoise per request or import, as `farmOperations` already does with `prospectsMemo`.

**SRVSTATS-16 · M · CONFIRMED · bug: Trade fits and the trading block cover every level-1 league in the save**
- **Evidence:** `trade.ts:234-241` (`majorLeagueDepth`) and `tradingblock.ts:170-176` have no league filter.
- **Effect:** a save with several major leagues proposes partners the GM can't deal with, and values every major leaguer in all of them on each request.
- **Fix:** filter to the club's league.

**SRVSTATS-17 · L · CONFIRMED · bug: Player Search's "busiest stint" can be a school season**
- **Evidence:** `league.ts:414-418` lacks the `league_id != 0` filter every other reader uses, so a draftee's high-school or college line can be shown, labelled "L10" or "L11".
- **Fix:** add the filter.

**SRVSTATS-18 · L · CONFIRMED · doctrine: Standings says "this league has no wild card" when the export simply lacks `league_playoffs`**
- **Evidence:** `playoffs.ts:83-89`, `:136`.
- **Fix:** add an unknown state.

**SRVSTATS-19 · L · CONFIRMED · doctrine: Player Development's input reads unknowns as 0**
- **Evidence:** `org.ts:664-666` and `:705`: `kpct` is 0 when `bf` is missing, `(s.er ?? 0)` gives a 0.00 ERA, and the diff is 0 when the baseline is null. These feed `evaluateProspectDecision`.
- **Trigger:** only schema-variant exports.
- **Fix:** pass null and let the judgment go indeterminate.

**SRVSTATS-20 · L · CONFIRMED · doctrine: the card shows an unknown pitch ceiling as equal to the current grade**
- **Evidence:** `player.ts:324` (`talent ?? r`).

**SRVSTATS-21 · L · CONFIRMED · doctrine: rating-snapshot composites average around missing tools**
- **Evidence:** `history.ts:546-557`, `avg` over the tools that are present. These composites drive the development trends (`:887`, `:1361`).

**SRVSTATS-22 · L · CONFIRMED · doctrine: the AI briefing and storylines are told an unknown budget, market or fan interest is 0**
- **Evidence:** `valuation.ts:314-335` (`teamFinances`). `clubFinances` already exists to replace it.

**SRVSTATS-23 · L · CONFIRMED · doctrine: the season falls back to the computer's calendar year**
- **Evidence:** `valuation.ts:231` (`new Date().getFullYear()`) contradicts D-022. It feeds Leaders and the AI.

**SRVSTATS-24 · L · SUSPECTED · bug: one human manager is assumed**
- **Evidence:** the inbox is read with `recipient_id = 1` hard-coded (`trade.ts:399`, `:484`). Tenure merges every human manager's rows (`gameplan.ts:326`).
- **Trigger:** multiplayer leagues.

**SRVSTATS-25 · L · CONFIRMED · bug: a tied game counts as a loss**
- **Evidence:** `schedule.ts:111` (`us > them`), so a tie is recorded as `won: false` and counted as a loss. `trends.ts:69` likewise.

**SRVSTATS-26 · L · CONFIRMED · security: part of the AI key is stored in plain JSON**
- **Evidence:** `unusable.ts:39` writes the key's length plus its last 6 characters to `unusable-models.json`. Two keys can also collide on that fingerprint.
- **Fix:** use a salted hash.

**SRVSTATS-27 · L · CONFIRMED · bug: missing columns crash the draft board and every stat page**
- **Evidence:** the draft board (`rosterops.ts:848-860`) names file columns without the `columns.has` check `roster.ts:136` uses. `stats.ts:159-161` sums `ibb/hp/sf` without a check.
- **Effect:** a missing column fails the board or every stat page.

**SRVSTATS-28 · L · CONFIRMED · bug: an unknown ERA prints as "0.00 ERA" on the trading block**
- **Evidence:** `tradingblock.ts:110` (`(s.era ?? 0)`).

**SRVSTATS-29 · L · CONFIRMED · bug: a crafted sort key crashes the React player route**
- **Evidence:** `/api/players?sort=constructor` (or `__proto__`) returns a 500, because `PLAIN_SORTS[sortKey]` is a prototype member (`league.ts:325-327`).

**SRVSTATS-30 · L · CONFIRMED · outdated: duplicated, disagreeing constants**
- **Evidence:** three level-name maps disagree on level 5 (`valuation.ts:241` 'A', `minorLeagueRoster.ts:75` 'SA', `player.ts:98`). There is a dead ternary at `stats.ts:308`. `clearBattedBallCache` has no caller (see SRVINFRA-05). `forgetWire` and `forgetSearchIndex` are only called by tests.

**SRVSTATS-31 · L · SUSPECTED · bug: the SRVINFRA-13 fix could wrongly start fresh rating histories (extends SRVINFRA-13)**
- **Evidence:** `looseName` (`historyIdentity.ts:97`) strips the latin-1 control bytes. "Šimon" decoded the old way reads "imon"; after a Windows-1252 decode it reads "simon".
- **Effect:** with the 0.999 continuity line, a league where more than 0.1% of names carry Š, Ž or Œ would be refused its own history right after that fix.
- **Fix:** normalise the old misread when comparing.

**SRVSTATS-32 · M · CONFIRMED · test-gap: the stat engine's arithmetic is untested**
- **Evidence:** OPS+, ERA+, FIP (and its constant), BABIP, the park adjustment and wRC+ in `computeBatting`/`computePitching` have no direct tests (`runEnvironment.test.ts` covers only the wOBA scale). No test checks that two pages agree on one player's line. That is how SRVSTATS-04 and SRVSTATS-05 got in.

## Riskiest areas needing a deeper look and better tests
1. **The season-line layer.** About 12 hand-written SUM queries (roster, lineup, pitching, league, form, trade, tradingblock, org, leaders, twoway, staff, gameplan) each choose their own columns, level filter, `league_id != 0` filter, club join and "current season". They feed one untested engine. Every proven stat bug here is a drift between them. One `seasonLine(playerIds, {level, league, season})` reader, with a cross-page agreement test, would close the class.
2. **Ratings read outside `scoutedEvidence.ts`.** The boundary test only checks the files it names and only direct `gloves(` calls. Any helper that wraps a raw read escapes it, as `glovesLine` shows. Make `gloves()`, the fielding main table and `players_*` rating tables reachable only through the adapter, and test by call graph or by banning the imports.
3. **Identity keys and "current club" joins.** Notes and watchlist go by save name. Leaders, game-plan matchups, wire injuries and the inbox all attribute history by today's club or human #1. These are wrong answers that look plausible, and fixtures with one league and one human never show them.

## Upstream-era modules to retire or rewrite
- **`rosterops.ts`:** four unrelated features in one file (crunch, leaders, staff, draft). `computeDraft`, `advise` and the React routes are React-only and should retire at cutover; split leaders, staff and draft into their own modules.
- **`valuation.ts`:** a grab-bag. `teamFinances` and `seasonYear` duplicate `clubFinances` and `leagueRules.season` with worse unknown handling. The level names and the prompt briefings belong elsewhere.
- **`gloves.ts`:** its raw reader should fold into `scoutedEvidence.ts`.
- **`league.ts` `computePlayers`:** rewrite the stat sort to rank in SQL or from a per-import table.
- **React-only routes** in `league.ts` (`name-index`) and `trade.ts` (`search-players`, `trade/roster`, `trade-proposals`) can go with Electron.
