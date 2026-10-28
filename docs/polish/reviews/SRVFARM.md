# SRVFARM deep hunt: Minor League Operations

**Scope.** I read the slice in full: `server/farm*.ts`, `playingTime.ts`, `minorLeagueRoster.ts`, `prospectAssignments.ts`, `prospectDecision.ts`, `rehabAssignments.ts`, `destinationFit.ts`, `clubArrival.ts` and `farmRoutes.ts`. I also read their direct dependencies (`currentAssignment.ts`, `org.ts computeProspects`, `stats.leagueBaseline`, `mlbEvidence.farmConsequence`, `presentation/farm/words.ts` and `assignments.ts`), the farm docs (Parts 2, 3, 8 and 9.1) and the farm rule. SRVPRES-04 and -13 and SRVSTATS-15 and -19 are not repeated; where I build on them it is marked.

**Setup.** Worktree: `(scratch)` at e6cdd08, detached, with `node_modules` symlinked. Nothing was committed, no app was launched, and no real data was touched.

**Proving tests.** Every test asserts the correct behaviour, so each failure is the bug. All 12 fail today. Run them in the worktree with `npx vitest run tests/srvfarm/`:
- `tests/srvfarm/srvfarmProofs.test.ts` (10 tests)
- `tests/srvfarm/srvfarmRehab.test.ts`
- `tests/srvfarm/srvfarmProspectsTwice.test.ts`

## Findings, most severe first

**SRVFARM-01 · H · PROVEN · bug: a pitcher's park adjustment runs backwards for strikeout pitchers and is far too weak for everyone else**
- **Evidence:** `farmResults.ts:185-188` (league population) and `:382-384` (the player). Both compute `lgFIPRaw - fip/park`, where `fip` is the raw FIP numerator per inning, with no constant.
  - Raw FIP is negative for a high-strikeout, low-home-run pitcher, so dividing by a hitters'-park factor above 1 makes him look worse.
  - For an average arm (raw about +1), it removes only about a quarter of the park effect, because the constant of about 3 is never scaled.
  - The MLB code does it right: `resultsMetrics.ts:263` divides the full ERA-scale value.
- **Proof:** the same 30-inning line (45 K, 6 BB, 1 HR) rates −0.18 in a 1.1 park and +0.22 in a 0.9 park. Test: `srvfarmProofs` › SRVFARM-01.
- **Trigger:** every pitcher's percentile and `aboveLeague`, which feed `currentAssignment` (mastered or overmatched), assignment conclusions, retention and the attention list. Elite strikeout prospects in hitters' parks are hit hardest.
- **Fix:** adjust on the ERA scale: `lgFIPRaw - ((fip + C)/park - C)` with `C = lgERA - lgFIPRaw`, or just compare FIP/park against league FIP.

**SRVFARM-02 · H · PROVEN · doctrine (D-018): men nothing was read about get a green "Regular work"**
- **Evidence:**
  - With no conflict, `readOpportunity` defaults to `regular_work` / "No job on this club is contested for him" (`playingTime.ts:1083-1085`).
  - `computeFarmSystem` keeps that default (`farmOperations.ts:792`) for rehab and injured men.
  - `ownOpportunityOf` (`farmOperations.ts:643-663`) returns it whenever the club has played fewer than 20 games (`jobRead` returns null), when a hitter has no job, and for every pitcher in a job nobody contests. In the last case it attaches his `not_used` work read but keeps `regular_work`.
  - `words.ts:94` shows it as "Regular work", tone good, in the Assignments Work column (`presentation/farm/assignments.ts:28`) and in the Decision ownership row.
  - `team_record` missing also becomes 0 games (`farmUsage.ts:42-46`, `farmResults.ts:221-225`).
- **Proof:** `srvfarmProofs` › SRVFARM-02, three tests:
  - a club with 10 games played;
  - an injured man out 60 days;
  - an assigned starter with 0 starts in 60 club games, where `work.level` is `not_used` but the verdict is still `regular_work`.
- **Trigger:**
  - every affiliate for its first 20 games, which is the whole of April and much of a complex-league season;
  - every injured or rehab man;
  - every unused reliever or starter, development-priority prospects included.
- **Fix:** return `indeterminate` when nothing was read, `not_read` for injured or rehab men, and the own-work level for pitchers, even if a quiet bullpen stays a non-finding.
- extends B-12.

**SRVFARM-03 · H · PROVEN · doctrine (D-026): a rehab assignee is reviewed and counted as one of the affiliate's own players**
- **Evidence:** roster health and the org view exclude him (`minorLeagueRoster.ts:254`, `farmOrganization.ts:111`). But:
  - he still gets an `AssignmentReview` (`farmOperations.ts:773-884`), and `reviewAssignment` has no rehab input;
  - he is counted in the affiliate's developmental assessment, "past this level's window" and "no production" (`:913-924`, `farmAffiliate.ts:573-653`);
  - he can reach the attention list (`:1037-1054`), and the past-window count (`:1056`);
  - he is in `organization.scope.players`;
  - his opportunity reads "Regular work" (SRVFARM-02).
- **Proof:** `srvfarmRehab.test.ts`: with the log establishing the rehab, the affiliate's assessment counts him (1, expected 0) and `farm.assignments` lists him.
- **Trigger:** any MLB veteran on rehab with 40 or more PA (or 12 or more IP) at the affiliate. He reads "past the level's developmental window; where he plays is an organizational question".
- **Fix:** carry `rehab` into the review; give a "parent-club player on rehab, not reviewed" conclusion and keep him out of the affiliate and organization counts and the attention list.

**SRVFARM-04 · H · PROVEN · bug: three definitions of "can play a position", including a false critical "Nobody covers SS"**
- **Evidence:** the three definitions are:
  - roster health counts a listed man, or a revealed grade of 35 or more (`minorLeagueRoster.ts:286, 301-308`);
  - farm `coverage` is any revealed grade above 0 (`farmOperations.ts:434-438`);
  - operational coverage counts `graded` as 35 or more, and `listedOnly` only when coverage does not include the position (`farmAffiliate.ts:247-255`, `farmOperations.ts:1181-1186`).
- **Effects:**
  - A listed SS with a revealed SS grade of 20-34 is neither graded nor listed-only, so the club gets a critical `position_uncovered`, while its roster health counts him as playable and as part of the defense.
  - The cascade pool (`farmCascade.ts:186`) takes any revealed grade, so a 1B with an SS grade of 25 "fills SS".
  - The org depth view does the same, and `majorLeagueThinPositions` (`farmOperations.ts:1167-1177`) uses grades above 0, so the MLB club is almost never "thin" and the critical depth finding rarely fires.
- **Proof:** `srvfarmProofs` › SRVFARM-09: "Nobody on the roster covers SS."
- **Trigger:** weak-glove listed shortstops or catchers, common at low levels; and every SS or C vacancy in the MLB↔farm contract.
- **Fix:** one exported `canCover(grade, listed)` rule (`PLAYABLE_GRADE` or listed), used by all four readers; `listedOnly` should mean "listed, and the grade is below `PLAYABLE_GRADE`".

**SRVFARM-05 · M · PROVEN · bug: an injury that began last season is dropped, so the games he missed count as games he wasn't used**
- **Evidence:** `injuryAbsences` keeps a spell only if it starts in the current year (`farmUsage.ts:357`).
- **Proof:** a 300-day spell from last August gives no absence in May, and `recentUsageFor` then reads 15 observable games and `sufficient` evidence, with 0 played. Test: SRVFARM-03 in `srvfarmProofs`.
- **Trigger:** Tommy John or any winter-spanning injury. On return he reads "not used" or "occasional", is squeezed (a blocking conflict) and is raised for attention.
- **Fix:** keep spells whose `[from, to)` overlaps the season's window. The SQL also reads the whole injury history unfiltered on every build (`:351`); filter it by player and date.

**SRVFARM-06 · M · PROVEN · bug: the recent window counts playoff, exhibition and other-season games**
- **Evidence:** `clubGameLogs` takes every `played = 1` game, with no `game_type` and no year filter (`farmUsage.ts:221-226`). Every other module filters `game_type = 0` (`trends.ts:42`, `playerState.ts:396`, `probableStarters.ts`). The season usage it is set beside is regular-season `split_id = 1`. `lastGamesElsewhere` has the same gap (`:314-327`).
- **Proof:** a spring game, a playoff game and a last-season game all land in the log. Test: SRVFARM-04 in `srvfarmProofs`.
- **Trigger:** playoffs (the window becomes the playoff roster's games), early season if past games are kept (ROADMAP.md:408 says this is unknown), and exhibitions.
- **Fix:** `COALESCE(game_type,0) = 0` and the season's year in both queries.

**SRVFARM-07 · M · PROVEN (code) / SUSPECTED (export shape) · bug: an All-Star appearance makes a man a "recent arrival"**
- **Evidence:** `lastGamesElsewhere` treats any line under another `team_id` as "played for another club" (`farmUsage.ts:323-326`). An All-Star or national-team club is another `team_id`, and `tenureOf` takes the later of the two dates (`farmRecentUsage.ts:132-138`).
- **Proof:** All-Star game (`game_type` 4, club 999), and the bound becomes the 14 July date. Test: SRVFARM-04 › All-Star in `srvfarmProofs`.
- **Trigger:** every minor-league All-Star. For about 15 games after the break his role reads `unknown`, with "He joined the club N games ago: the game log has him playing for another club".
- **Fix:** count only regular-season games against non-all-star clubs (`teams.allstar_team = 0`).

**SRVFARM-08 · M · PROVEN · bug: destination fit throws when the leagues table lacks a column**
- **Evidence:** `destinationLeague` selects `l.league_level` and eight `l.avg_rating_*` columns without checking them (`destinationFit.ts:560-600`).
- **Proof:** dropping `avg_rating_contact` gives `SqliteError: no such column`. Test: SRVFARM-05 in `srvfarmProofs`.
- **Trigger:** older, fictional or variant exports. The throw takes down `computeProspects`, so the whole farm (SRVPRES-04) and MLB Operations' development reads fail.
- **Fix:** build the SELECT from `tableColumns('leagues')`, with an absent column read as null.

**SRVFARM-09 · M · PROVEN · perf: Player Development's prospect pass runs twice per farm build, and about seven times per import**
- **Evidence:**
  - `buildFarmViews` calls `computeProspects` directly (`farmViewsBuild.ts:100`) even though the session it just used has `session.prospects()` (`farmOperations.ts:711`).
  - Each import also reruns the whole farm system and the prospect pass in several places: the Front Office (`frontOfficeBuild.ts:148`), the AI briefing (`ai.ts:79,97`, each with its own `farmBriefing → computeFarmSystem`), storylines (`storylines.ts:116,146`) and the legacy dashboard (`dashboard.ts:336`).
  - Each pass costs about a second on a real save (MINOR_LEAGUE_OPERATIONS.md §7.3).
- **Proof:** a spy counts 2 calls in one build. Test: `srvfarmProspectsTwice.test.ts`.
- **Fix:** use `session.prospects()`; let the Front Office and AI hooks share one per-import farm reading.
- extends SRVSTATS-15.

**SRVFARM-10 · M · CONFIRMED · bug: moving an injured man is blamed for a hole he never filled**
- **Evidence:** only rehab is special-cased (`farmConsequence.ts:231`). `vacancyOf` reads absolute counts after the move (`:411-440`), and an injured man was never counted (`minorLeagueRoster.ts:246-254`). Before and after are identical, yet the cascade runs, and when the club was already short it reports "No defensible move follows, and X is left short at SS".
- **Trigger:** a recall or MLB-IL move of an injured AAA player.
- **Fix:** return "absorbed: he was not counted (injured)" as is done for rehab; more generally, measure the vacancy as a delta from before.

**SRVFARM-11 · M · CONFIRMED · bug: organization depth and rotation counts include injured men**
- **Evidence:** `OrgPlayerFact` has no `injured` field; `members` filters only rehab (`farmOrganization.ts:111`, `farmOperations.ts:931-950`).
- **Effects:**
  - "Two upper-minors players can play SS" is counted with one of them out for the season, which suppresses the critical "MLB thin, farm thin" finding.
  - `startersByLevel` counts injured role-11 arms as being used as starters.
- **Fix:** pass `injured` through and exclude injured men as the affiliate reading does.

**SRVFARM-12 · M · CONFIRMED · bug: in the offseason, last season's line is read as "this season", and the year comes from the whole save**
- **Evidence:** `currentYear()` is `MAX(year)` over every league's batting rows (`farmOperations.ts:211-218`; the same rule is in `org.ts:268,287`).
- **Effects:**
  - After OOTP's rollover, before the new season's stats exist, the farm reads last season's usage and lines as current.
  - Percentile verdicts and "No statistics at this level this season" say nothing about which year was read.
  - In a multi-league save, one league's later-labelled season moves every affiliate's year.
- **Fix:** take the year per league (its `current_date` or season year), and label production read from a completed season.

**SRVFARM-13 · M · PROVEN (SQL) / SUSPECTED (trigger) · robustness: the affiliate tree query never stops on a parent loop**
- **Evidence:** the same `WITH RECURSIVE … UNION ALL` appears four times: `farmOperations.ts:137-148`, `minorLeagueRoster.ts:153-169`, `org.ts:129-134` and `mlbEvidence.ts topAffiliateTeamId`.
- **Proof:** a root whose `parent_team_id` is itself returns 1,000 rows from a two-team table under `LIMIT 1000`. Test: SRVFARM-06 in `srvfarmProofs`.
- **Trigger:** a malformed or edited export. The query is synchronous, so the server's thread spins forever.
- **Fix:** `UNION` (deduplicated), or a depth cap, in one shared helper.

**SRVFARM-14 · M · CONFIRMED · bug: an arrival's summary counts injured and rehab men as claimants**
- **Evidence:** in `farmArrivalFor`, `castOf` does not filter `competing` (`farmConsequence.ts:678`). `contested` and the summary ("would make N men with a claim", `:710, :725, :735`) count injured and rehab men, while `holders` (from `jobRead`) does not. The two disagree in the same answer.
- **Fix:** count `claimants.filter(competing)`.

**SRVFARM-15 · L · CONFIRMED · bug: a DH-listed man's "one job" is the first revealed position in table order**
- **Evidence:** `primaryPositionOf` falls back to `coverage[0]` (`farmOperations.ts:288`). OOTP position 10 (DH) maps to null at `:432`, and the order is C, 1B, 2B… So any revealed C grade makes him a catcher claimant. An empty job becomes the vacancy "—" (`farmConsequence.ts:395`).
- **Fix:** use his best revealed grade, or treat DH as its own non-fielding job.

**SRVFARM-16 · L · CONFIRMED · bug: an alternative's destination opportunity reads only the level's first club**
- **Evidence:** `destinationTeam = e.target.teams[0]` (`farmOperations.ts:798-824`).
- **Trigger:** two clubs at one level, such as DSL or complex clubs: "X has room at SS" ignores the other.
- **Fix:** read every club at the target level.

**SRVFARM-17 · L · CONFIRMED · doctrine: a league too small to compare is told "more of the season" will fix it**
- **Evidence:** `league_population_too_small` (`farmResults.ts:360-364`) becomes `not_assessable` (`currentAssignment.ts:231-243`), which says "There is no production to read yet", with "More of the season" as what would resolve it (`farmAssignments.ts:272-275, 469`). In a small fictional league this never resolves.
- **Fix:** a separate "league too small to compare" state.

**SRVFARM-18 · L · CONFIRMED · bug: park factor for a two-club line**
- **Evidence:** the player's line uses `MIN(team_id)`'s park (`farmResults.ts:261`); the population uses a bare, ungrouped `team_id` (`:153-165`).
- **Fix:** weight parks by opportunities, as `resultsEvidence.withPark` does.

**SRVFARM-19 · L · CONFIRMED · robustness / D-018: farm failures are silent or shown as zero**
- **Evidence:** MLB's farm port catches errors and returns null with no log (`mlbOperations.ts:82`), so an unknown is not said. The legacy dashboard chip shows `pressing: 0` when `computeFarmSystem` throws (`dashboard.ts:334-344`).
- **Fix:** log the error, and return an explicit "couldn't be read".
- extends B-13.

**SRVFARM-20 · L · CONFIRMED · bug: without a game log, the transaction log's arrival dates go unused**
- **Evidence:** tenure exists only inside `recentUsageFor`, which returns null without a game log (`farmOperations.ts:490-501`, `farmRecentUsage.ts:177`). A promoted prospect whose move is dated by the log is still "squeezed" on the season's shares (the §8.2 artefact).
- **Fix:** gate the season read on a dated `recent_arrival` when the log has one.

**SRVFARM-21 · L · CONFIRMED · test-gap: boundary tests miss part of the farm**
- **Evidence:**
  - `farmOperationsBoundary.test.ts:23-38` FARM omits `farmViewService.ts`, `farmViewsBuild.ts`, `clubArrival.ts`, `minorLeagueRoster.ts` and `rehabAssignments.ts`.
  - `evidenceBoundary` GUARDED omits `playingTime`, `farmRecentUsage`, `farmAffiliate`, `farmAssignments`, `farmCascade`, `farmRetention`, `farmOrganization`, `farmViewService` and `farmViewsBuild`.
  - Nothing tests "no unread man gets a positive verdict", which is why SRVFARM-02 shipped.
- **Fix:** derive the lists by glob (`farm*.ts` and friends), and add that invariant test.

**SRVFARM-22 · L · CONFIRMED · test-gap/robustness: the Player Development → farm payload is untyped**
- **Evidence:** `computeProspects(orgId) as unknown as ProspectPayload` (`farmOperations.ts:711`), and `cascadePorts` (`farmConsequence.ts:457`) reads the same rows. A rename in `org.ts` silently gives zero alternatives and "not_evaluated" cascades.
- **Fix:** give `computeProspects` a real return type.

**SRVFARM-23 · L · CONFIRMED · doctrine-adjacent: the AI is handed legacy codes under a label they contradict**
- **Evidence:** `farmBriefing` (`farmOperations.ts:1295-1305`) labels items "never a call-up" but includes `mlb_ready_discussion`. It sends raw `decision.recommendation` codes, which can contradict the farm review it sends beside them, and turns an unknown age into 0.
- **Fix:** send the review's conclusions only.

**SRVFARM-24 · L · CONFIRMED · outdated (D-053): window constants came from the owner's save**
- **Evidence:** the window constants (`RECENT_WINDOW_GAMES` 15, `RECENT_ROTATION_SHARE` 0.6/0.3, `RECENT_MINIMUM_GAMES` 6, at `farmCalibration.ts:144-164`) were backtested on one save and are stamped provisional. There is no per-save refit or gate; `farm:usage-window` is a script.
- **Fix:** put them on the D-053 path when the farm's turn comes.

**SRVFARM-25 · L · CONFIRMED · dead code and stale comments**
- `healthScenario`'s `teamId === -1 ? key : key` (`farmOperations.ts:718`).
- An orphaned doc comment at `:529`.
- The blocker comment "one level up" (`:828-832`); blockers are in fact on the same club.

## Riskiest areas needing deeper tests
1. **"Can play a position" and listed-only logic,** spread over `minorLeagueRoster`, `farmOperations` (coverage, `listedOnly`, `majorLeagueThinPositions`), `farmAffiliate` and `farmCascade.poolFor`. There is no shared rule and no cross-module invariant test (SRVFARM-04).
2. **The temporal layer** (`farmUsage`: game log, absences, `lastGamesElsewhere`, `currentYear`). No `game_type`, season or all-star filters, and the fixtures have neither multi-season nor non-regular games. It needs a fixture shaped like a real multi-season export with playoffs, All-Star games and winter injuries (SRVFARM-05, -06, -07, -12).
3. **Verdict defaults and special cases.** `regular_work` is the "no conflict" default, and injured and rehab handling is scattered (rehab handled in roster, organization, cascade and consequence but not reviews; injured handled in reviews but not organization or consequence). It needs the invariant "a man nothing was read about, or who isn't the club's, never gets a positive or ordinary verdict" (SRVFARM-02, -03, -10, -11).

## Upstream-era code to retire or rewrite
- **`prospectDecision.ts` with `org.ts computeProspects`' production layer.** Readiness rests on raw OPS diff ×250, raw ERA and K% against level or league averages, with no park adjustment. Its age pressure pushes older men toward promotion. The farm's own reading (`farmResults`: league percentile, park-adjusted) is a second, different Player Development production measure, so a review can say "mastered" while the alternatives say "not ready". Rebuild readiness on `farmResults` so Player Development has one reading.
- **The four copies of the recursive organization query** (SRVFARM-13): replace them with one deduplicated, cycle-safe helper.
- **`dashboard.ts`'s farm chip,** a legacy web path that swallows errors as zeros (SRVFARM-19).
