## SRVMLB deep hunt: Major League Operations and calibration (read-only, origin/feature/swiftui e6cdd08)

**Worktree:** `(scratch)`. It is detached, and `node_modules` is symlinked from the main checkout.
- Nothing was committed or pushed.
- No app or UI test was launched.
- No real data, Keychain or OOTP files were touched.

**Proving tests.** Each test asserts the *correct* behaviour, so a failure is the bug.
- Run all of them with `npx vitest run tests/deephuntSrvmlb*.test.ts`. Result: 5 files, 15 tests, all failing.
- `npx tsc --noEmit` reports no errors in them.

Files:
- `tests/deephuntSrvmlbUsage.test.ts` (01)
- `tests/deephuntSrvmlbPosture.test.ts` (02)
- `tests/deephuntSrvmlbReview.test.ts` (03, 06, 11)
- `tests/deephuntSrvmlbClearing.test.ts` (04, 05)
- `tests/deephuntSrvmlbBench.test.ts` (07, 08, 09)

I skimmed SRVSTATS, SRVPRES, SRVVALUE, SRVINFRA and MERGED (B-16, B-17, B-25 and others). Nothing below repeats them; extensions are marked.

---

### Findings, most severe first

**SRVMLB-01 · H · PROVEN · bug: "Who plays where" counts a player's innings and plate appearances for every club in the league, not ours**
- **Evidence:**
  - `server/mlbEvidence.ts:482-499` (`hitterUsage`) reads `fieldingUsage` (`server/resultsEvidence.ts:358-378`). That query has no `team_id` filter and groups by player, year and position.
  - `battingHistory` merges stints across clubs (`withPark`, `resultsEvidence.ts:78-99`). So `gs` and `pa` are the season total for all his clubs.
  - The denominator is our club's games (`teamGamesPlayed`).
  - `buildLineupPicture` (`lineupPicture.ts:79-143`) then names a man acquired from a league rival as our regular at the position he played for the other club. Our real regular falls to the bench.
- **Knock-on effects:**
  - The DH reading becomes our-club starts minus fielding starts summed across all clubs.
  - `discover()` skips the wrong regulars (`mlbResponses.ts:532-547`).
  - Bench review, role-holder needs, shift plans and the "Started N games at X this season" note are all affected.
  - The standards refit reviews every club the same way (`mlbCalibrationRefit.ts:75-114`).
- **Proof:** 800 innings at shortstop for club 3 plus 88 at second base for us returns 800 innings at shortstop. He becomes our regular shortstop instead of the man with 530 innings there for us. His PA reads 420, not 40.
- **Trigger:** any mid-season trade inside the league.
- **Fix:** filter fielding and batting usage by `team_id = orgId`, as `farmUsage.ts:86` does.
- **Test gap:** the fixture's `players_career_fielding_stats` has no `team_id` or `league_id` (`tests/fixture.ts:263`), which hides this.

**SRVMLB-02 · H · PROVEN · bug: The odds model's "games left" counts spring training, All-Star and postseason games**
- **Evidence:**
  - `server/posture.ts:135-140` runs `COUNT(*) FROM games WHERE home_team = ? OR away_team = ?` with no `game_type` filter.
  - Every other schedule reader filters `game_type = 0` (`saveIdentity.ts:231`, `schedule.ts:76`, `probableStarters.ts`).
  - `runsFor` (`posture.ts:60-69`) also sums `team_batting_stats` and `team_pitching_stats` with no year, split or level filter. `frontOffice/teamSeason.ts:8-10` documents that those tables carry placeholder rows and can give a club two rows (SUSPECTED impact).
- **Proof:** 140-10 with 162 regular-season games plus 30 exhibitions gives `gamesLeft` 42 instead of 12. A finished season reads 30 games left.
- **Effect:** the odds are pulled toward the middle and never settle at the season's end. This reaches:
  - the Standings card (D-072);
  - the MLB urgency and act bar (03);
  - Player Value's club value of a win, whose odds curve uses `gamesLeft` (`playerValue.ts:452-462`).
- **Fix:** add `COALESCE(game_type, 0) = 0`, and read runs through `teamSeason`'s one-row-per-club reader.

**SRVMLB-03 · M · PROVEN · doctrine: For a club with no philosophy, the postseason odds alone move the staff's call, and the lean is credited to the "competitive window" (D-036, D-060)**
- **Evidence:**
  - `mlbOperations.ts:40-51` always supplies the posture.
  - `readContext` (`staffPreference.ts:96-123`) sets urgency 'high' from odds of at least 0.55 when no window is set (null reads as 'balanced'), and 'low' at 0.25 or below.
  - `actBar` (`:245-256`) then lowers or raises the bar with `dimension: 'competitiveWindow', value: null`. Its text is "The window and the season both favor acting now".
  - `mlbReport.ts:487-495` and `:760` compare against a "neutral" with no context at all, so the change is shown as the philosophy's.
  - `deadlineRead` also ignores `gapRead` ('no_race' reads as level with a place) and `scheduleRead` ('assumed' 162). Standings and Player Value respect both (`playerValueWinValue.ts:98`).
- **Proof:** with no dimensions set and odds 0.8, `actBar` returns that reason.
- **Fix:** lean on the season only when a window is set, or attribute it to a 'season' dimension. Better, drop the D-060-rejected odds from MLB's decision path until "Playoff odds from the roster" replaces them.

**SRVMLB-04 · M · PROVEN · doctrine: An option whose charge this season is unknown is classed "Routine and reversible", even when it may be his final option year (D-018)**
- **Evidence:** `mlbResponses.ts:745-749`. `charges` is null when `usedThisSeason` is null, and `klass = charges && left === 0 ? 'higher_cost' : 'routine'`. The cost line itself says "could not be established".
- **Proof:** remaining 1, `usedThisSeason` null gives class `routine`.
- **Trigger:** an export without `options_used_this_year`.
- **Effect:** plans' "routine" labels and `followUpFor` inherit it (`mlbPlans.ts:131-137`).
- **Fix:** with `charges === null` and `remaining <= 1`, use a not-established class, or `higher_cost` with the reason said.

**SRVMLB-05 · M · PROVEN · bug: Clearing an active spot misfiles Player Rights' answers**
- **Evidence:** in `mlbResponses.ts:735-770` the `else` branch classes as `unresolved` both of these cases:
  1. **Option and designation both ineligible.** A definite "no" is labelled "Not established" and counted as a way to clear.
  2. **Option indeterminate and designation eligible.** A designation that clears the spot becomes 'unresolved'.
- **Consequence:**
  - `feasibility` becomes `unresolved_only` (`:856-857`).
  - `withClearing` (`:952-955`) moves otherwise viable candidates to 'indeterminate' with the false line "Every way to clear the spot he needs is one Player Rights cannot yet establish".
  - The active-spot clearing path is marked uncertain even though a designation Player Rights allows would clear the spot.
  - `fortyManClearingOption` handles the same cases correctly (`:845-856`).
- **Proof:** case 1 gives `class 'unresolved'`. Case 2 gives `feasibility 'unresolved_only'` instead of `'available'`.
- **Fix:** return null for ineligible-on-both. Offer the designation (disruptive) when it is eligible and the option is not established, and say the option is unknown.

**SRVMLB-06 · M · PROVEN · doctrine: A holder with no visible tools and weak results is filed as "Results lag tools (watch)" (D-018)**
- **Evidence:**
  - `roleReview.ts:399-401`: `lensLow(null)` is false, so a missing tools lens reads as "not low".
  - `:477-483` then gives `results_weak_tools_fine`.
  - The labels are "Results lag tools (watch)" (`presentation/majorLeague/words.ts:117`), "results lag his tools" (`mlbReview.ts:255`) and "his tools are not [at the back]" (`mlbReport.ts:713`).
- **Effect:** in an export or role without visible ratings (no-ratings mode, or players our scouts haven't rated, D-067) no holder can ever become a need, and each is described as having fine tools.
- **Proof:** results at the 5th percentile, `ratingsPct` null, below the deep floor, gives `results_weak_tools_fine`.
- **Fix:** a null lens gives a one-lens kind ("results weak; tools not visible") with unknown named.

**SRVMLB-07 · M · PROVEN · bug: With no games behind it, every hitter is "on the bench" (extends B-17)**
- **Evidence:**
  - `teamGamesPlayed` (`mlbEvidence.ts:502-508`) returns 0 for a missing `team_record` row, and the season's usage is empty on opening day or after OOTP rolls the season.
  - `buildLineupPicture` then has no regulars.
  - The bench review credits the starting catcher, shortstop and centre fielder as their own backups.
  - `discover()` offers every regular as a no-transaction role change.
- **Also:** `SELECT g, w, l FROM team_record` throws if `g` is absent, while the refit's `gamesPlayed` (`mlbCalibrationRefit.ts:61-70`) tolerates it.
- **Proof:** 8 hitters with 0 team games gives 8 bench players.
- **Fix:** with 0 or unknown games, treat the lineup as not established (no bench review, no regular-exclusion bypass) and say so. Read `team_record` schema-tolerantly.

**SRVMLB-08 · M · PROVEN · bug: Coverage floors are a fixed 5 SP / 7 RP / 2 C whatever the league's roster size or era**
- **Evidence:** `mlbNeeds.ts:50-58`. `roleNeeds` gives `critical` at a deficit of 2 or more (`:177`).
- **Proof:** a 21-man league with 4 SP and 5 RP gets a critical relief shortage permanently.
- **Trigger:** fictional leagues, the 1930s USBL save, any league with a small active limit.
- **Fix:** derive floors from the league's active limit, or measure them per save (D-053), and state the basis.

**SRVMLB-09 · M · PROVEN · doctrine: The bench reads unknown as "nobody" (D-018)**
- **Evidence:** `benchReview.ts`:
  - The hands check counts only known `bats`. With handedness missing it says both "Nobody on the bench bats left-handed" and "Nobody … right-handed".
  - The "soft" functions (pinch-hit, runner, defensive) report `strength: 'none'` with "Nobody on the bench is a bat that would be sent up" when no bat is graded.
  - A hard cover gap is "no visible grade", which raises a `bench_coverage` need (`mlbReview.ts:160-177`). In an unscouted or no-ratings export every club gets catcher, middle-infield and centre-field needs from absence of evidence.
- **Proof:** 3 bench men with `bats` and `batValue` null gives both hand findings and pinch-hit 'none'.
- **Fix:** add an 'unknown' strength and a hands-unknown branch. Don't raise a need when the grades are not visible.

**SRVMLB-10 · M · CONFIRMED · doctrine: Glove weights are adopted on "no worse than the starting weights", not "clearly better" (D-053 amendment, 2026-09-25)**
- **Evidence:**
  - `mlbCalibrationFit.ts:785-799`: `passed: f >= p - tolerance`.
  - `:825-831`: `gateOf`.
  - `mlbCalibration.ts:127-139`: `servesOwn('defense')` is true for any adopted fit, and the hover then calls them the league's own.
  - The other tuning values with a rival use `calibrationDetector.decide`.
- **Trigger:** a save with two or more consecutive seasons carrying zone rating plus a third (rare today).
- **Fix:** put glove weights under the detector, or record the owner's exemption as a D-number.

**SRVMLB-11 · L · PROVEN · doctrine: An unmeasured role is served with the starting value but labelled the save's own**
- **Evidence:**
  - `mlbCalibrationFit.ts:379` fills unmeasured roles with the prior inside a `source: 'save'` set.
  - `roleStandards.ts:158-172` stamps every role with `served.source`.
  - `roleReview.ts:431-435` then says "For closers in this league the typical … is about 71" (the prior's number).
- **Trigger:** a role with no holders at the measurement in force (an early-season measurement served later, rel:long, DH).
- **Proof:** the test in `deephuntSrvmlbReview.test.ts`.
- **Fix:** carry a per-role source.

**SRVMLB-12 · L · CONFIRMED · doctrine (show the basis): The working estimate is described as "visible tools" or "visible ratings"**
- **Evidence:**
  - `mlbReport.ts:182-185` (`standingPlayer`) feeds the blended estimate as `composite`.
  - `roleStanding.ts` reasons say "His visible tools are N", and `resultsContext` says "despite the weakest visible tools".
  - `mlbReport.ts:421` says "the weakest … by visible ratings" and `:423` says "cannot be placed (no visible rating)".
  - `mlbReport.ts:384` falls back to the composite on a different scale when there is no evidence.
- **Fix:** word these as "working estimate", and never mix the scales.

**SRVMLB-13 · L · CONFIRMED · doctrine: In the needs list and the MLB inbox, the shaded severity (including the odds) orders the needs within each group**
- **Evidence:** `mlbReview.ts:309` sorts by the shaded `severity`. `presentation/majorLeague/views.ts` `inbox()` keeps that order. The badge uses the neutral severity, but the order does not (D-060 / D-065 spirit).
- **Fix:** sort by `explanation.neutralSeverity`.

**SRVMLB-14 · L · CONFIRMED · bug: An unknown active-roster count is read as full**
- **Evidence:** `mlbResponses.ts:620-627`. `spotOpen` is false when the counts are null, giving "The active roster is full: another player has to be moved first." (extends B-25 / B-10).
- **Fix:** add a third "not known" note.

**SRVMLB-15 · L · CONFIRMED · doctrine: The follow-up names an unknown as "the weakest"**
- **Evidence:** `mlbPlans.ts:131-137`. When nobody has an estimate, the first by name is "the weakest by working estimate … (no estimate)".
- **Fix:** say none can be compared.

**SRVMLB-16 · L · CONFIRMED · doctrine: Position needs rank a position by its backup when the starter is unknown**
- **Evidence:** `positionNeeds.ts:43-49` and `:107-108` (Free Agents, Draft Board and Trade fits read this). The `unknown` count is shown, but "thinnest" is claimed anyway.
- **Fix:** a position with any unvalued listed player is named apart, or its rank is said to be partial.

**SRVMLB-17 · L · CONFIRMED · robustness: Refit inputs throw on columns their `has()` guard doesn't check, and the yardstick then says "not measured yet" forever**
- **Evidence:**
  - `mlbCalibrationRefit.ts:228-247` (`agingInput` sums d, t, hr, bb, ibb, hp, sf without checking them).
  - `:277` (`defenseSeasons`).
  - `saveCalibration.ts:142-145` records nothing on a throw. So the attempt is retried at every import and `reasonOf(null)` gives 'not_measured'.
- **Fix:** check every summed column, and record the failure as an attempt with a plain reason.

**SRVMLB-18 · L · CONFIRMED · doctrine: Plan and pathway titles are written as orders**
- **Evidence:** `mlbPlans.ts`: "Send X down and bring in Y", "Designate X", "Move X to the bullpen", "Start X at SS". They are shown as pathway titles (`presentation/majorLeague/decision.ts:250, 268`). The banned-words list covers only the headline patterns.
- **Fix:** word them as options ("X down, Y up").

**SRVMLB-19 · L · SUSPECTED · perf (extends SRVSTATS-15): Opening a decision rebuilds the whole club review**
- **Evidence:**
  - `mlbOperations.ts:232` leads to `reviewNeedById` (`mlbReview.ts:319-321`), which runs `reviewClub`: every SP, RP, hitter, platoon and cover read.
  - `buildResponsePacket` asks `ports.rights` up to three times for overlapping sets (`mlbResponses.ts:1185, 1197, 1083`).
  - The Morning Report adds `farmNextByPosition` and `mlbDiscussionAssessments`.
- **Fix:** memoise per request and import.

**SRVMLB-20 · L · CONFIRMED · test-gap: The fixtures hide the real export's shape**
- **Evidence:**
  - The fielding table has no `team_id` or `league_id` (01).
  - Posture tests insert games with the default `game_type` 0 only (02).
  - `mlbOperationsBoundary.test.ts`'s MLB list omits `mlbExplain`, `roleReview`, `benchReview`, `bullpenRoles` and `lineupPicture`.
- **Fix:** add the real columns and a trade and season-rollover case to the fixture.

**SRVMLB-21 · L · CONFIRMED · smell: Small slips that each carry a concrete risk**
- `morningReport.ts` (staffInputs) classes pitchers by raw role codes 11 and 13 instead of `normalizedPitchingRole` (cf. SRVSTATS-08).
- `mlbResponses.ts:473` hard-codes "of 3 used" for options.
- `farmNextByPosition` (`mlbEvidence.ts:629-655`) can name an injured or rehab minor leaguer as "the farm's next man".
- `agingInput` ages are season minus birth year, while the review uses the player's current age (off by up to a year).

### Checked and found sound
- `saveCalibrationStore`: date keys go through `parseGameDate`, and the reverted-save bound is respected.
- The detector maths and hysteresis.
- Worker staleness, roster-review cache invalidation on import and on record (workers are per-job, so no stale module caches).
- `withRatingSource` scoping, and the D-068 set-aside.
- Platoon's unknown handling, the leverage rescale (self-consistent) and `rosterScenario` counts.

### Three riskiest areas
1. **Usage and "this season" readers behind the lineup picture** (`hitterUsage`, `fieldingUsage`, `teamGamesPlayed`, `currentSeason`). Trades, season rollover and day one all break it (01, 07), and the fixture can't show it. A real-shape fixture with a mid-season trade and a rolled season is needed.
2. **The posture/odds model and everything leaning on it:** Standings, MLB urgency and act bar, Player Value's win value (02, 03). It is upstream, filters nothing, its `RIVAL_TALENT` is not fitted per save (D-053), and MLB ignores its own no-race and assumed-schedule flags.
3. **Mapping Player Rights' three-valued answers into clearing classes and feasibility** (`activeClearingOption`, `constraintClearing`, `withClearing`) (04, 05). It needs a table-driven test over option × designation × charged-this-season × remaining.

### Upstream-era code to retire or rewrite
- **`server/posture.ts`.** The buy/hold/sell model the owner judged weak and off-mission (D-060) still decides MLB urgency and the staff's "act" bar, and prices a win in Player Value. Retire it from the MLB decision path now. Rewrite the odds on `frontOffice/teamSeason.ts`'s filtered one-row reads (regular season only), with the unknown-race and assumed-schedule states respected.
- **`roleStanding.evaluateRoleStanding`.** Its React-era wording ("visible tools") no longer matches its input, which is now the working estimate (12). Rewrite the wording and remove the composite fallback in `mlbReport`'s rows.
