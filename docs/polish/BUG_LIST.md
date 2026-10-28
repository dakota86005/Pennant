# Pennant for Mac: the polish bug list

Inputs: four read-only hunts (FO, MLB, FARM, OFF) at `origin/feature/swiftui` b49bc47, 205 findings. Every H and M finding was checked twice against the code (plus the saved payloads and CI screenshots where cited). Disagreements between the two checks were settled by reading the code (MLB-02, MLB-14) or by the stronger evidence. Nothing was run, and the real save was not used.

Swift path shorthand: `PF/` = `macos/Packages/PennantFeatures/Sources/`, `PD/` = `macos/Packages/PennantDesign/Sources/PennantDesign/`, `PK/` = `macos/Packages/PennantKit/Sources/PennantKit/`.

## Summary

- Findings: 205 (H and M, all checked: 150; L, spot-checked: 55).
- Verdicts: CONFIRMED 162, PLAUSIBLE 13, REFUTED 8, UNCHECKED 22 (every UNCHECKED one is an L).
  - FO H and M (35): 30 confirmed, 4 plausible, 1 refuted.
  - MLB H and M (43): 39 confirmed, 2 plausible, 2 refuted.
  - FARM H and M (41): 37 confirmed, 2 plausible, 2 refuted.
  - OFF H and M (31): 29 confirmed, 1 plausible, 1 refuted.
- Merged items: 56. By tier: Tier 1 22, Tier 2 28, Tier 3 6.
- By kind: behaviour 16, data 25, words 6, layout 8, perf 1.
- By tier and kind: Tier 1: behaviour 5, data 14, words 1, layout 2; Tier 2: behaviour 9, data 11, words 2, layout 5, perf 1; Tier 3: behaviour 2, words 3, layout 1.
- Wording items the phrasebook migration will absorb, so nobody fixes them twice: B-10, B-30, B-31, B-51, B-52, B-53.

## Ranked merged list

Tier 1 = broken, wrong data, privacy, or something the owner hit. Tier 2 = confusing, contradictory, or layout that hides content. Tier 3 = polish. Within a tier, the items that touch the most screens come first.

### Tier 1

**B-01 · Hover notes show developer details and a developer's local save**
- Status: open
- Tier 1 · data · Front Office, MLB Ops, Farm, Player windows, League Office, Trades · size M · batch 2
- The GM sees: Value and roster-map hovers read "fitted by production-3b.1 (playerValueProductionFit.ts) ... a developer's local save (its league id) ... npm run calibrate ... (D-053)", 20 times per club report; Org Comparison and the farm's lines table show "provisional ratings prior", "(a developer's local save, its export date)", "(Q-3)".
- Cause: Developer provenance kept in calibration stamps is served raw as the GM-facing basis: server/playerValueCalibration.ts:366-372, :458-463, :1533-1538, :2319-2325; server/developmentFit.ts:64-70; server/calibration.ts:42-44 (CALIBRATION_RUN, preferred by dossier.ts:57 and leagueHistoryViews.ts:35); carried by server/presentation/frontOffice/morning.ts:920, :961, trades/desk.ts:55, frontOffice/desk.ts:142, league/orgComparison.ts:130, farm/organization.ts:109-120; drawn verbatim by PD/Depth.swift:223-224. Other stamps with the same provenance: resultsMetrics.ts, toolsModel.ts, roleStandards.ts, roleReview.ts, mlbCalibrationFit.ts, mlbResultsFit.ts, mlbToolsFit.ts, mlbPlatoonFit.ts.
- Absorbs: FARM-10 (confirmed), FARM-15 (confirmed), OFF-13 (confirmed)

**B-02 · Missing stats are shown as zero**
- Status: open
- Tier 1 · data · MLB Ops, Scouting, League Office, Player windows, Trades · size M · batch 1
- The GM sees: Rosters, Lineup and Player Search show H 0, .000, 0.0%; Leaders ranks ten players 1-10 on .000 or "Not known"; the player overview says "0 HR" while History says "—"; History shows ERA 0.00 over 65 IP.
- Cause: Blank counting stats coalesced to 0 before rates are computed: server/stats.ts:176, :233, :286-287 (computeBatting/computePitching, used by roster.ts, lineup.ts, pitching.ts, league.ts:424 Player Search, form.ts, trade.ts, tradingblock.ts); server/rosterops.ts:223-245 (leaders: h/ab with null h, nulls sort as 0); server/player.ts:190-199, :221-223 (`|| 0`, null arithmetic); server/presentation/player/dossier.ts:341 (`?? 0` HR). Also roleReview.ts:461 `d.pct ?? 0`, org.ts:837-852 career PA/IP.
- Absorbs: MLB-06 (confirmed), OFF-04 (confirmed), OFF-05 (confirmed), FARM-07 (confirmed), FARM-09 (confirmed)

**B-03 · The sidebar doesn't respond like a Mac sidebar**
- Status: open
- Tier 1 · behaviour · Shell (every department) · size M · batch 5
- The GM sees: Clicking a department header doesn't open it, there is no keyboard path, departments pile up open, Following rows need a double-click, and the highlight lags behind each click.
- Cause: PF/Shell/SidebarView.swift:36-59 (untagged DisclosureGroup label in List(selection:), no tap toggle); PF/Shell/MainWindowModel.swift:98-101 (selection derived from route), :107, :121, :125 (expanded only grows); PF/Shell/MainWindowView.swift:410 (.id(window.route) rebuilds the detail on every click); AppKit namers walk views in updateNSView: SidebarView.swift:140, :172, :208, FollowingSection.swift:152; PF/FeatureCore/Attention.swift:246-254, :299 (double-click only names); PF/FrontOffice/AiWritingViews.swift:146.
- Absorbs: FO-01 (confirmed), FO-02 (plausible), FO-13 (confirmed), FO-14 (confirmed), FO-48 (plausible)

**B-04 · Table text is cut off and can't be read on hover**
- Status: open
- Tier 1 · layout · Scouting, Finance, Medical, League Office, MLB Ops, Farm · size M · batch 9
- The GM sees: The Draft Board's Read column ends in "…", Us vs Them's two club columns both read "Club…", Lineup's "Why here" and Rosters' verdicts sit off-screen while #, B and Pos take 100+ pt, and the horizontal scroll bar covers the last row.
- Cause: One width per column kind and lineLimit(1), with a tooltip only from cell.hint: PF/FeatureCore/OfficeKit.swift:474-482, :609, :613, :45; PF/MajorLeague/ServedTable.swift:71-81 (non-numeric ideal 104); word columns served as numeric at server/presentation/league/usVsThem.ts:171-172; Read cell served with no hint at server/presentation/scouting/draftBoard.ts:202; Level cell doubled at server/presentation/farm/assignments.ts:39.
- Absorbs: OFF-02 (confirmed), OFF-19 (confirmed), OFF-44 (unchecked), MLB-32 (confirmed), MLB-34 (confirmed), FARM-22 (confirmed)

**B-05 · "Transaction history unavailable" never says how to fix it**
- Status: open
- Tier 1 · data · Shell, Front Office, MLB Ops, Farm, Player windows, Settings · size M · batch 6
- The GM sees: Data Status, the toolbar's permanent orange triangle, the MLB overview, player History and Rights, six identical rehab lines per affiliate and the Decision all name the problem; none points to Settings ▸ Transaction log.
- Cause: server/presentation/dataStatusWords.ts:183 (ACTIONS.partial = null), :121, :158-163, :176, :196 (partial → caution triangle); server/dataFreshness.ts:188 (headline reused by server/presentation/majorLeague/views.ts:162); missing-log lines with no remedy at server/playerDossierBuild.ts:60, server/playerContext.ts:144, server/playerRights.ts:448, server/assignmentContext.ts:322 (repeated per player at server/presentation/farm/affiliates.ts:68-79, :130); PF/Shell/MainWindowView.swift:341-361.
- Absorbs: FO-04 (confirmed), FO-23 (confirmed), FO-24 (confirmed), MLB-37 (confirmed), FARM-35 (confirmed), FARM-13 (confirmed)

**B-06 · Counts and plurals read wrong ("Started 1 games", "2076")**
- Status: fixed (batch 10)
- Tier 1 · data · All departments · size M · batch 3
- The GM sees: "Started 1 games", "what regular left fielders takes", "No glove to put in late, runner…", "17 points of it is still projection", "2076 draft-eligible players" beside "Show all 2,076", "-29" beside "−21", "0-15" beside "15–15".
- Cause: No shared count formatter: the plural helper never groups thousands at server/presentation/clubhouse/common.ts:112 (imported by 22 modules) and about 18 local copies (farm/words.ts:263, frontOffice/desk.ts:72, majorLeague/views.ts:37, player/words.ts:79, dataStatusWords.ts:74, officeTable.ts:368, trades/words.ts:52, mlbReport.ts:146, playingTime.ts:357, mlbNeeds.ts:127, playerValue.ts:755, dataFreshness.ts:100, franchise.ts:233, …); statText at clubhouse/common.ts:129; templates bypass plural at server/mlbEvidence.ts:450-451 and server/mlbExplain.ts:60-61 (plural labels from roleStandards.ts:109-117); server/rosterops.ts:670; server/presentation/majorLeague/views.ts:121; hyphen records at server/schedule.ts:228-229.
- Absorbs: OFF-01 (confirmed), MLB-48 (confirmed), MLB-08 (confirmed), MLB-09 (confirmed), MLB-39 (confirmed), MLB-27 (confirmed), MLB-46 (confirmed), OFF-36 (confirmed), OFF-33 (unchecked), OFF-39 (confirmed)

**B-07 · Another save's farm, players and notes stay on screen after a switch**
- Status: open
- Tier 1 · behaviour · Farm, Player windows, League Office (club windows) · size M · batch 4
- The GM sees: After a save or club switch the old farm, Decision, dossier and comparison stay up as "Updating"; a restored player window can show a different man with the same id; notes never reload after an import.
- Cause: PK/AppModel.swift:829-837, :898-906 call follow() on nine stores but not FarmStore, PlayerStore, LeagueStore or FollowingStore; PK/PlayerStore.swift:9 claims otherwise, :93 loadNotes has no key; PK/Routing.swift:53-88 (window refs carry bare ids); PF/Player/PlayerNotesTab.swift:49.
- Absorbs: FARM-01 (confirmed), FARM-37 (confirmed)

**B-08 · Pages can get stuck on Loading or keep an old error**
- Status: open
- Tier 1 · behaviour · Farm, MLB Ops, Finance, League Office, Scouting, Philosophy & Staff, Trades · size M · batch 4
- The GM sees: Moving quickly between views can leave one on "Loading" until the next import; a failed trade weigh's error stays on a later good deal; a failed Free Agents detail shows nothing and can't be retried.
- Cause: In-flight guard plus a dropped cancelled answer, with views remounted on every route: PK/FarmStore.swift:154, :164 (same pattern ClubhouseStore.swift:237/251, ScoutingStore.swift:270/281, LeagueOfficeStore.swift:152, OfficeStore.swift:214, PhilosophyStore.swift:101, TradesStore.swift:157/194); PF/Shell/MainWindowView.swift:410; PK/TradesStore.swift:193 (cache hit skips clearing the problem), PF/Trades/TradeDeskView.swift:136; PK/OfficeStore.swift:155-161 and PF/FeatureCore/OfficeKit.swift:810.
- Absorbs: FARM-02 (confirmed), OFF-11 (confirmed), OFF-26 (confirmed)

**B-09 · Innings are written as decimals (10.7 instead of 10.2)**
- Status: fixed (batch 10)
- Tier 1 · data · MLB Ops, Player windows, Farm, Scouting, Trades · size S · batch 3
- The GM sees: Pitching Availability "33.7", player History "38.3 IP", outings "6.7", the Decision's "Season line (10.7 IP…)", while the Morning Report writes "12.1 innings".
- Cause: ip = outs/3 kept as a decimal and formatted dec1: server/stats.ts:288, :301; server/presentation/statCatalog.ts:59; server/presentation/clubhouse/common.ts:126; server/player.ts:217-221, :281 → server/presentation/player/dossier.ts:979, :1016; server/org.ts:662, :685; server/presentation/farm/prospects.ts:25; server/form.ts:129; server/tradingblock.ts:110; server/playingTime.ts:932; server/mlbEvidence.ts:170. The right formatter already exists at server/presentation/frontOffice/morning.ts:206.
- Absorbs: MLB-05 (confirmed), FARM-08 (confirmed)

**B-10 · Walls of "on the 0–100 scale"**
- Status: open
- Tier 1 · words · MLB Ops · size M · batch 10 · the phrasebook absorbs it
- The GM sees: "bat 74 on the 0–100 scale; glove 17 on the 0–100 scale…" about 90 times in one Position players payload; one hover says "77 is typical" while the rest say "50 is typical"; glove shows two numbers; reasons start lower case.
- Cause: server/roleStanding.ts:73 (onScale, used in 10 modules); server/presentation/majorLeague/words.ts:31, :43 (SCALE_HINT on every cell, Not known cells too); server/presentation/majorLeague/views.ts:196, :226, :233-238, :322; server/roleReview.ts:454-466.
- Absorbs: MLB-13 (confirmed), MLB-24 (confirmed), MLB-26 (confirmed), MLB-29 (confirmed)

**B-11 · Code words reach the screen ("level 2", column names)**
- Status: open
- Tier 1 · data · MLB Ops, Player windows, Finance, Farm · size S · batch 2
- The GM sees: "Season line (55 PA, level 2)", "Recall, level 2", the column name rules_minor_league_fa_minimum_years in Contract & Rights, "Not known projected" in 50 payroll cells (a raw protected_prospect on the farm Decision is tracked under FARM-20).
- Cause: `level ${n}` interpolated: server/presentation/majorLeague/decision.ts:361, server/mlbResponses.ts:564, server/mlbReport.ts:382, :429, :435, :635, :743, server/playerValueRatings.ts:810-818, server/playerValueCone.ts:239-240; server/playerValueControl.ts:444, server/playerValueContract.ts:137; server/presentation/finance/payroll.ts:398; server/presentation/farm/words.ts:47, :77.
- Absorbs: MLB-04 (confirmed), FARM-27 (confirmed), OFF-14 (confirmed)

**B-12 · Pages say all is well when nothing has been read**
- Status: open
- Tier 1 · data · Farm, MLB Ops · size M · batch 1
- The GM sees: Affiliates: "Are its players developing? No issue found" in green with 0 players read; Assignments: green "Regular work" for everyone at a club with 0 games; Game Plan: "No history against this club yet" beside 10 meetings.
- Cause: Absence of findings read as good: server/presentation/farm/affiliates.ts:18-23; server/playingTime.ts:1083-1084 (readOpportunity defaults to regular_work; no conflict is built below the club-games minimum); server/gameplan.ts:103-121, :246-250 with server/presentation/clubhouse/schedule.ts:298 (a missing table or failed read prints "no history"; the join also uses the pitcher's current team).
- Absorbs: FARM-04 (confirmed), FARM-06 (confirmed), MLB-07 (confirmed)

**B-13 · Counts show zero when the list isn't known, and unpriced contracts drop out of totals**
- Status: open
- Tier 1 · data · Finance, Philosophy & Staff · size M · batch 1
- The GM sees: "Available now (0)" when the export can't say who's available; "0 affiliates" on Coaching Staff when affiliate staff simply aren't exported; 2044 payroll "Most likely +$4.1M (2 players)" with 24 unpriced, then a green "$150.0M free".
- Cause: server/presentation/finance/freeAgents.ts:200 with PF/Finance/FreeAgentsView.swift:92, :103; server/rosterops.ts:409-414 (inner join drops affiliates) with server/presentation/philosophy/staff.ts:229; server/presentation/finance/payroll.ts:90-101, :137 (unpriced count only shown when nothing is priced).
- Absorbs: OFF-09 (confirmed), OFF-25 (confirmed), OFF-06 (confirmed)

**B-14 · A saved AI key looks the same as no key**
- Status: open
- Tier 1 · behaviour · Settings, Front Office · size S · batch 6
- The GM sees: After Save the field empties back to "Get a key at console.claude.com" and "Key set" wears the same grey eye as "No key"; Ollama says ready without checking; with AI off the Briefing's fix sits only in a hover.
- Cause: server/presentation/ai/keys.ts:36-43 (neutral tone for every state), :55 (keyless providers always configured); PD/Tone.swift:38 (neutral = eye.fill app-wide); PF/Shell/SettingsView.swift:774, :835; PF/FrontOffice/AiWritingViews.swift:115-133.
- Absorbs: FO-06 (confirmed), FO-27 (confirmed), FO-42 (confirmed), FO-26 (confirmed)

**B-15 · Roster map: the hovered player is drawn under other text**
- Status: open
- Tier 1 · layout · Front Office, League Office (club windows) · size S · batch 9
- The GM sees: Hovering a plate grows it, and later plates, the legend and the staff cards paint over it; the catcher and DH plates spill under the legend.
- Cause: PD/RosterDiagram.swift:198-211, :266-282 (centre-anchored .position in a fixed 540-pt ZStack, no zIndex); PF/FrontOffice/MorningReportView.swift:351-352; PF/FrontOffice/ClubReportView.swift:163-164.
- Absorbs: FO-03 (confirmed), MLB-36 (plausible), FO-37 (unchecked)

**B-16 · The same player appears twice on a Decision**
- Status: open
- Tier 1 · data · MLB Ops, Farm · size S · batch 7
- The GM sees: On a "replace" Decision a bench man who has played the spot appears as both "Current" and "On the bench" (very likely Vargas on the Tawa LF page); the farm views would crash or misdraw on a duplicate row.
- Cause: server/mlbReport.ts:621-629 (incumbents include every usage backup), server/mlbResponses.ts:547 (discover skips only regulars), server/mlbReport.ts:704 concatenates, :189 displayOrder never dedupes; PF/Farm/FarmDevelopmentView.swift:46 (Dictionary(uniqueKeysWithValues:) traps), PF/Farm/FarmDecisionView.swift:163, :270.
- Absorbs: MLB-01 (confirmed), FARM-40 (plausible)

**B-17 · The only catcher is counted as his own backup**
- Status: open
- Tier 1 · data · MLB Ops · size M · batch 1
- The GM sees: The top need is "1 healthy catcher … minimum of 2", yet Bench & Backups says catcher is backed up by that same catcher, and no overview card mentions the shortage.
- Cause: An unsettled spot puts its lone holder on the bench: server/lineupPicture.ts:97-101, :131-133; server/mlbReview.ts:135; server/benchReview.ts:178-183; glances read only reviews: server/presentation/majorLeague/views.ts:88-95, :118-121.
- Absorbs: MLB-03 (confirmed), MLB-38 (confirmed)

**B-18 · Farm findings don't name the player**
- Status: open
- Tier 1 · data · Farm · size S · batch 7
- The GM sees: A finding's player shows as "Farm 1 F, age 22" with no name; VoiceOver reads the same.
- Cause: server/presentation/farm/common.ts:72-73, :149 (the note replaces the name); PF/Farm/FarmCommon.swift:194.
- Absorbs: FARM-03 (confirmed)

**B-19 · The Morning Report says four departments "come in a later version"**
- Status: open
- Tier 1 · data · Front Office · size S · batch 8
- The GM sees: Scouting, Trades, League and Philosophy are marked as coming later though their views exist, and the Front Office report counts "4 of 8 departments reporting".
- Cause: server/presentation/frontOffice/desk.ts:451-454 (stale NOT_YET list, also drives :418 and :365).
- Absorbs: FO-05 (confirmed)

**B-20 · A farm player's club link opens the big-league club**
- Status: open
- Tier 1 · behaviour · Player windows · size M · batch 8
- The GM sees: The header says "Farm 1 F (AAA)" but the club name and "Open His Club" open Club 1 N.
- Cause: server/presentation/player/dossier.ts:207, :214 (clubOpen = organizationId); PF/Player/PlayerWindowView.swift:97-98, :187-189; club windows are organization-level only.
- Absorbs: FARM-24 (confirmed)

**B-21 · The Trade Desk weighs trades that can't happen**
- Status: open
- Tier 1 · data · Trades · size S · batch 8
- The GM sees: Sending another club's player for one of ours, or a three-club deal, gets a normal weighed answer.
- Cause: Nothing checks who holds each player: server/tradeDeskService.ts:152-176, server/trade.ts:165, PK/TradesStore.swift:117-127.
- Absorbs: OFF-10 (confirmed)

**B-22 · Draft Board sorting only sorts the first 300 players**
- Status: open
- Tier 1 · data · Scouting · size M · batch 8
- The GM sees: Sorting by Now or Ceiling misses everyone below the first 300 of a 2,076-player class until "Show all".
- Cause: server/presentation/scouting/draftBoard.ts:78, :360 (300-row page, no serverSorts); PF/FeatureCore/OfficeKit.swift:502-511 (client sort).
- Absorbs: OFF-23 (confirmed)

### Tier 2

**B-23 · Decision pages say the same thing two or three times**
- Status: open
- Tier 2 · data · MLB Ops, Farm, Player windows, Front Office · size L · batch 7
- The GM sees: "Player Development has not assessed him as durable major-league role" three times, two "Missing: transaction log" lines, the affiliate's whole issue list under every candidate, the cascade stop twice, "Value is in wins, and dollars are unknown" twice in one note, "26 of 26 (+1) (The active roster is full…)"; on the Morning Report two overlapping gap sentences and "Farm 1 F: …" on every desk item.
- Cause: Sections re-emit reasons their callers already include: server/presentation/majorLeague/decision.ts:283, :302, :306, :322-349, :377; server/mlbResponses.ts:406, :1235; server/mlbReport.ts:408; server/presentation/farm/decision.ts:119, server/presentation/farm/words.ts:162; server/playerValueSurplus.ts:499 and server/playerValueFinances.ts:555; Morning Report gaps at server/presentation/frontOffice/wire.ts:239-244; farm desk grouping plus single items at server/presentation/frontOffice/farm.ts:75, :126.
- Absorbs: MLB-12 (confirmed), MLB-15 (confirmed), MLB-16 (confirmed), MLB-17 (confirmed), FARM-21 (confirmed), FARM-26 (confirmed), FO-18 (confirmed), FO-21 (confirmed)

**B-24 · Decision pages contradict themselves**
- Status: open
- Tier 2 · data · MLB Ops, Farm · size M · batch 7
- The GM sees: "Visible tool ratings: complete; not assessed: Contact…", a shortstop-or-second need titled "second baseman", "Too early to read" beside "24 under the first line", "Read from nothing yet", "1 Why his assignment is being reviewed" for a player not in question, a raw protected_prospect, a bare "28 · Current", and the key "Why Pennant says this" block drawn smaller than the next heading.
- Cause: server/presentation/majorLeague/decision.ts:164, :175, :356, :536; server/mlbReview.ts:164; server/roleReview.ts:466-475; server/presentation/majorLeague/views.ts:251, words.ts:203; PF/Farm/FarmDecisionView.swift:128; server/presentation/farm/words.ts:47, :77; PF/MajorLeague/DecisionView.swift:169.
- Absorbs: MLB-18 (confirmed), MLB-19 (confirmed), MLB-21 (confirmed), MLB-22 (confirmed), MLB-23 (confirmed), MLB-28 (confirmed), FARM-20 (confirmed)

**B-25 · A Decision promises things that aren't there**
- Status: open
- Tier 2 · data · MLB Ops · size M · batch 7
- The GM sees: "The active roster is full: another player has to be moved first" with no way-to-clear section; "the candidates who do not are listed below" with no candidates; an empty catcher picture with a "What this comparison is" disclosure and nobody compared.
- Cause: server/mlbResponses.ts:621, :635, :644-647, :1201-1205 (clearing packet built only from established steps); server/mlbReport.ts:396, :407-408; server/presentation/majorLeague/decision.ts:129-179, :519-524 (no empty state).
- Absorbs: MLB-10 (confirmed), MLB-11 (confirmed), MLB-20 (confirmed)

**B-26 · Pages disagree on today's date and how fresh the data is**
- Status: open
- Tier 2 · data · All departments · size M · batch 8
- The GM sees: Finance and Medical say "Through May 6", Trades and Coaching Staff "Through May 5", League shows no byline; the same "Not checked against your save" is a grey ? in one department and an orange triangle in another; mastheads print two dates; the window subtitle is hidden.
- Cause: Three freshness builders: server/presentation/officeTable.ts:333-340, server/presentation/trades/desk.ts:96-100, server/presentation/league/orgComparison.ts:267-272 (plus majorLeague/views.ts:169); bylines from two sources: officeTable.ts:353 (csv.currentDate) vs tradeDeskBuild.ts:37, philosophyViewService.ts:59, clubhouseViewsBuild.ts:92, farmViewsBuild.ts:69, frontOfficeBuild.ts:104 (simulatedThrough); PF/League/LeagueOfficeViews.swift:26; PF/FrontOffice/MorningReportDesign.swift:117; server/presentation/dataStatusWords.ts:237-238; PF/Shell/MainWindowView.swift:78, :82.
- Absorbs: OFF-15 (confirmed), OFF-16 (confirmed), FO-22 (confirmed), FARM-39 (confirmed), FO-43 (confirmed)

**B-27 · Page headings get cut off or run under the inspector**
- Status: open
- Tier 2 · layout · Finance, Medical, League Office, Philosophy & Staff, Farm, MLB Ops, Shell · size M · batch 9
- The GM sees: "Payroll & Bud…", "Not checked ag…", Coaching Staff and Us vs Them heads running past the edge ("the seas"), Decision titles "Every candida…", the menu bar's desk items cut to one line.
- Cause: PD/TablePane.swift:72-88 (head squeezed vertically, no fixedSize), :110-113; PF/FeatureCore/OfficeKit.swift:309 (OfficeSectionPicker .fixedSize(), used by LeagueOfficeViews.swift:155, :259, :452 and CoachingStaffView.swift:24); PD/Typography.swift:69-71 (MagazineSection title); PF/Finance/FreeAgentsView.swift:45; PF/Shell/MenuBarGlanceView.swift:119-126.
- Absorbs: OFF-07 (confirmed), OFF-08 (confirmed), MLB-43 (confirmed), OFF-35 (confirmed), FO-33 (confirmed)

**B-28 · Narrow windows and the inspector squeeze pages into uselessness**
- Status: open
- Tier 2 · layout · MLB Ops, Farm, Finance, Shell · size M · batch 9
- The GM sees: 40-Man shows three rows at 1280; farm tables at 900 show three columns; the Horizon Board falls back to half-empty cards at 1024; glance cards stack; the inspector with nothing pinned still squeezes the page and offers a one-choice picker.
- Cause: PF/MajorLeague/ClubhouseViews.swift:312 (detailShare 0.45); PF/Farm/FarmAssignmentsView.swift:56; PF/Finance/HorizonBoardView.swift:29 (minWidth 760); PF/MajorLeague/StandingViews.swift:81-84 (ViewThatFits on unwrapped widths); PF/Shell/MainWindowView.swift:507-510, :529.
- Absorbs: MLB-33 (confirmed), FARM-36 (confirmed), OFF-24 (confirmed), MLB-60 (confirmed), FO-34 (confirmed)

**B-29 · Detail cards are empty, repeat their label, or sit under the wrong row**
- Status: open
- Tier 2 · behaviour · All departments · size M · batch 9
- The GM sees: A franchise season or leader opens a blank card; "4 of 8" sits over "4 OF 8 DEPARTMENTS REPORTING"; our club's deadline read appears under Club 3's row; Injury Report keeps a full-height empty pane.
- Cause: PF/FeatureCore/OfficeKit.swift:688, :698 (Card drawn for empty detail), :800-807 (page notes drawn under any chosen row); PF/FeatureCore/FrontOfficeViews.swift:370 (ReportFigures repeats a value contained in its label); server/presentation/league/standings.ts:293-355.
- Absorbs: FO-16 (confirmed), OFF-21 (confirmed), OFF-22 (confirmed), OFF-45 (unchecked)

**B-30 · Department names and method terms speak on screen**
- Status: open
- Tier 2 · words · Farm, MLB Ops, Front Office, Player windows · size M · batch 10 · the phrasebook absorbs it
- The GM sees: "Player Development says…", "MLB Operations' own cover read", "outside this module", "Clearly ahead of 1 · not separable from 1", "Closer · high stakes", "The Book … AND more PA", "(neutral 8.4 wins)", "held-out seasons", "work share", "Pennant's first-pass minimum", "Not yet" reading as "none".
- Cause: server/farmOrganization.ts:223; PF/Farm/FarmProspectsView.swift:68, :263; server/presentation/farm/assignments.ts:83; server/presentation/frontOffice/morning.ts:762, :832; server/presentation/majorLeague/views.ts:387; server/lineup.ts:82-90, :136; server/presentation/player/dossier.ts:690, :713; server/farmAffiliate.ts:694; server/mlbNeeds.ts:52, :176; server/presentation/farm/development.ts:214, :282, :301.
- Absorbs: FARM-16 (confirmed), FO-20 (confirmed), MLB-30 (confirmed), MLB-31 (confirmed), FARM-25 (confirmed), FARM-49 (confirmed), MLB-49 (confirmed), FARM-19 (confirmed)

**B-31 · The same caveat is repeated row after row**
- Status: open
- Tier 2 · words · MLB Ops, Farm, Player windows, League Office, Finance · size M · batch 10 · the phrasebook absorbs it
- The GM sees: The 60-day-refusal passage on all 32 40-man rows with "(observed and documented)" 58 times; 10 of 12 farm findings served open in red; "not valued here" six times on Compare; "1 game to play" 11 times on Us vs Them; Roster Moves rows that restate each other; the payroll "costs" wall.
- Cause: server/playerRights.ts:775-779, server/presentation/majorLeague/words.ts:99; server/presentation/farm/common.ts:147-154 (expanded when critical); server/presentation/player/compare.ts:84, :128, player/words.ts:51; server/presentation/league/usVsThem.ts:184-199; server/presentation/player/dossier.ts:269-278.
- Absorbs: MLB-35 (confirmed), FARM-14 (confirmed), FARM-32 (confirmed), OFF-18 (confirmed), FARM-28 (confirmed), OFF-34 (unchecked)

**B-32 · Payroll room and payroll differ between Finance pages**
- Status: open
- Tier 2 · data · Finance, League Office · size M · batch 8
- The GM sees: Free Agents says "Room now $60.0M / next season $90.0M", Payroll says $65.9M / $101.0M free, Org Comparison says payroll $90.0M against $84.1M committed; Contracts says "Free agent after 2046 or later" beside "Control not established" for 2044-2046.
- Cause: Two definitions under one name: server/presentation/finance/words.ts:175-193 (budget minus team_financials or OOTP's estimate, against today's budget) vs server/payroll.ts:305-309 and server/presentation/finance/payroll.ts:102, :138-140 (budget minus committed contracts); server/presentation/league/orgComparison.ts:152, :181, :239-245; server/presentation/finance/words.ts:141 vs contracts.ts:78-88.
- Absorbs: OFF-03 (confirmed), OFF-29 (confirmed)

**B-33 · Staff titles differ between pages, and the GM's report may be credited to someone else**
- Status: open
- Tier 2 · data · Philosophy & Staff, Front Office, All department mastheads · size S · batch 8
- The GM sees: Ana Frey is "head trainer" in the Staff room and "team doctor" on Medical; Terry Ellis is "scout" and "head scout"; the Front Office report is "Prepared by Morgan Brock, general manager" with no check that the GM isn't the user.
- Cause: Two role vocabularies: server/staff.ts:105, :120 vs :506-507 (used by server/presentation/catalog.ts:169, :254); seatHolder has no human check at server/staff.ts:521-531 / catalog.ts:248-255, unlike tradeVoice at staff.ts:413-424.
- Absorbs: FO-09 (confirmed), FO-17 (plausible)

**B-34 · "Whose ratings" reads Not known, with no way forward**
- Status: open
- Tier 2 · data · Shell, Farm, Player windows · size S · batch 8
- The GM sees: Data Status's Ratings row says "Not known" without saying a fresh import fixes it; the player's Ratings tab is headed "Not known" above a full set of grades and mentions a snapshot set aside, while Development Tracking says no snapshots are kept.
- Cause: server/presentation/dataStatusWords.ts:153; server/ratingMode.ts:142; server/presentation/farm/development.ts:282-315; server/history.ts:370 (raw unpadded dates).
- Absorbs: FO-25 (confirmed), FARM-29 (confirmed), FARM-18 (plausible)

**B-35 · Clubhouse pages disagree on who plays where and how good he is**
- Status: open
- Tier 2 · data · MLB Ops · size M · batch 7
- The GM sees: Depth Chart's right field is "Nobody listed here" while Lineup bats P 1008 in RF; the "Bat" column shows the whole estimate when the bat is missing; a pitcher is "Not known" on Pitching staff but graded 73 on Depth.
- Cause: server/presentation/clubhouse/depth.ts:22-31, :86-91 (listed position vs usage elsewhere); server/presentation/majorLeague/views.ts:323-336 (`batValue ?? value`); server/roleReview.ts:425 vs depth grades.
- Absorbs: MLB-40 (confirmed), MLB-25 (confirmed), MLB-41 (plausible)

**B-36 · Pages forget or ignore where you were**
- Status: open
- Tier 2 · behaviour · MLB Ops, League Office, Finance, Player windows, Trades · size M · batch 4
- The GM sees: A desk link to a 40-man player in the other section doesn't switch to it; Lineup choices, filters and sorts reset on return; Decision groups can reopen the wrong way after a re-read; History keeps the old sort after switching record; a failed game plan never retries.
- Cause: PF/MajorLeague/ClubhouseViews.swift:285, :295 (`section ?? opened ?? first`), :92, :244, :340-341, :192-194; PF/MajorLeague/DecisionView.swift:35-53, :520-535 (state set once, keyed by offset); PF/Player/PlayerHistoryTab.swift:33, :97-105; PF/MajorLeague/ScheduleView.swift:93-101.
- Absorbs: MLB-42 (confirmed), MLB-53 (plausible), MLB-58 (confirmed), MLB-54 (unchecked), MLB-56 (confirmed), OFF-43 (unchecked), FARM-48 (plausible)

**B-37 · Farm rows and player windows lack the usual Mac controls**
- Status: open
- Tier 2 · behaviour · Farm, Player windows · size M · batch 5
- The GM sees: Player ▸ Open, Compare and Follow are disabled on farm rows; Return opens the Decision, not the player; multi-select Compare takes one man; clicking a finding's sentence opens its basis instead of expanding it; no ⌘1-⌘6 for player sections; double-click does different things on different pages.
- Cause: PF/Farm/FarmCommon.swift:208-238 (no focusedValue), :223-228, :158, :564 (ClaimText Button inside Fold label wins, PD/Depth.swift:62); PF/Farm/FarmAssignmentsView.swift:99-105, FarmProspectsView.swift:75-81, FarmDevelopmentView.swift:92-97; PF/Player/PlayerWindowView.swift:279-285; PF/Farm/FarmDecisionView.swift:44.
- Absorbs: FARM-11 (confirmed), FARM-12 (confirmed), FARM-41 (confirmed), FARM-50 (confirmed)

**B-38 · Farm pages open on empty filters**
- Status: open
- Tier 2 · behaviour · Farm · size S · batch 5
- The GM sees: Prospects opens on "Meetings · 0" ("No players match this view"), Assignments on "In Question Only", and Prospects and Development show the first player's detail with nothing selected; the starters table's "Spots" column holds a sentence (a green "Every man has a spot" for an empty rotation).
- Cause: PF/Farm/FarmProspectsView.swift:31, :45; PF/Farm/FarmAssignmentsView.swift:31; PF/Farm/FarmDevelopmentView.swift:53; PF/Farm/FarmOrganizationView.swift:84 with server/presentation/farm/organization.ts:92.
- Absorbs: FARM-17 (confirmed), FARM-23 (confirmed)

**B-39 · Setup contradicts itself and doesn't guide**
- Status: open
- Tier 2 · data · Setup · size M · batch 6
- The GM sees: "You manage 2 clubs in this save" with one club marked; "No OOTP saves were found" then "None found" with no word that OOTP's database must be exported first; some import failures say only "did not finish".
- Cause: server/saveDiscovery.ts:452-487 counts human clubs at every level (also viewingOrganization.ts:29) while server/org.ts:68-70 lists level 1 only; PF/Setup/SetupView.swift:149, :313-314, :372; server/presentation/saveWords.ts:122, :191.
- Absorbs: FO-08 (confirmed), FO-30 (confirmed), FO-31 (confirmed)

**B-40 · Settings hides choices and state**
- Status: open
- Tier 2 · behaviour · Settings, Shell · size L · batch 6
- The GM sees: No provider, model, AI features, auto-import or rounding choices; Updates has no Check Now, version or reason; notifications may never ask permission and show "on" when denied; the Transaction log field has no label; Appearance has a single-choice radio group.
- Cause: PF/Shell/SettingsView.swift:670-706, :883-889, :194-221; server/presentation/ai/keys.ts:48, :79; PF/Shell/UpdatesSettings.swift:16-39; macos/Pennant/OutsideTheWindow.swift:37-39, :62-88 (no notification delegate).
- Absorbs: FO-07 (confirmed), FO-32 (confirmed), FO-15 (confirmed), FO-40 (unchecked), FO-47 (unchecked)

**B-41 · Sidebar badges, the menu bar and the widget**
- Status: open
- Tier 2 · behaviour · Shell · size S · batch 5
- The GM sees: Sidebar badges show while the club question is open (the Dock badge hides); menu bar items can't be clicked and there's no refresh; the widget may tick "Updated 2 hours, 5 minutes ago".
- Cause: PF/FeatureCore/DepartmentModule.swift:64-68 (no clubOwed guard, unlike macos/Pennant/OutsideTheWindow.swift:55); PF/Shell/MenuBarGlanceView.swift:26, :119-126; macos/PennantWidgets/GlanceWidgetView.swift:103-104.
- Absorbs: FO-12 (confirmed), FO-44 (plausible)

**B-42 · Quick Open can open the wrong thing**
- Status: open
- Tier 2 · behaviour · Shell · size S · batch 5
- The GM sees: ⌘K's highlight can jump when late results arrive, so Return opens a different entry; only 12 results with no scroll; two different search fields; five views all called "Report".
- Cause: PD/CommandPalette.swift:29, :45, :51, :161; PF/Shell/MainWindowView.swift:92-112; server/presentation/searchWords.ts:48-84; server/presentation/catalog.ts:148-169.
- Absorbs: FO-28 (confirmed), FO-29 (plausible), FO-46 (confirmed)

**B-43 · Charts look broken or unexplained**
- Status: open
- Tier 2 · layout · Finance, League Office, Player windows, MLB Ops · size M · batch 9
- The GM sees: Franchise History's single unknown season draws as a huge hollow block; the payroll "could be" bars have no legend; the value chart ignores the club colours and its pending band covers known seasons; Season Trends shows .500 as "50%".
- Cause: PF/League/LeagueOfficeViews.swift:279-291; PF/Finance/PayrollView.swift:191; PF/Player/PlayerValueTab.swift:138-180; Season Trends payload charts[2].
- Absorbs: OFF-20 (confirmed), OFF-27 (confirmed), FARM-33 (confirmed), FARM-47 (confirmed), MLB-47 (confirmed)

**B-44 · Compare and History tables push content off-screen**
- Status: open
- Tier 2 · layout · Player windows · size M · batch 9
- The GM sees: A long value widens Compare's column and pushes the second player out of view; History's 13 fixed columns overflow, with W-L as "—-—" and teams as "C1"/"F1".
- Cause: PF/Player/CompareWindowView.swift:165 (two-way ScrollView, text never wraps); server/presentation/player/dossier.ts:978, :1088; server/player.ts:207 (t.abbr).
- Absorbs: FARM-31 (confirmed), FARM-34 (confirmed)

**B-45 · Heavy work on every redraw**
- Status: open
- Tier 2 · perf · Front Office, Scouting, Shell · size M · batch 5
- The GM sees: The Morning Report rebuilds its whole design from a ~100 KB payload twice per redraw; Player Search and the Draft Board re-join, re-sort and re-search all rows on every keystroke (unprofiled; may explain the CI stalls).
- Cause: PF/FrontOffice/MorningReportView.swift:173, :311 with MorningReportDesign.swift:99-103; PK/ScoutingStore.swift:108-112; PF/FeatureCore/OfficeKit.swift:503-511, :766-768.
- Absorbs: FO-35 (plausible), OFF-31 (plausible)

**B-46 · The Morning Report puts "To decide" last on ordinary windows**
- Status: open
- Tier 2 · layout · Front Office · size S · batch 9
- The GM sees: Below ~1,360-pt windows the desk comes after the map, staff and the league, one frame late; the Whole Desk button exists only here; "The rest" heads every row in a small league.
- Cause: PF/FrontOffice/MorningReportView.swift:95-106, :301-324, :367, :377.
- Absorbs: FO-11 (confirmed), FO-36 (confirmed), FO-41 (unchecked)

**B-47 · The philosophy summary contradicts itself when nothing is set**
- Status: open
- Tier 2 · data · Philosophy & Staff · size S · batch 8
- The GM sees: With every setting at 50 it says both "broadly balanced, without a strongly expressed lean" and "so this is a focused philosophy".
- Cause: server/presentation/philosophy/identity.ts:156, :186-193 (no branch for zero expressed settings).
- Absorbs: OFF-17 (confirmed)

**B-48 · The payroll budget box silently throws away what you type**
- Status: open
- Tier 2 · behaviour · Finance · size S · batch 4
- The GM sees: "150M", "$150", "150,000,000" or "150,5" revert to the old value with no message; Return then losing focus may save twice.
- Cause: PF/Finance/PayrollView.swift:312, :329-346 (Double() parse, silent revert).
- Absorbs: OFF-28 (confirmed)

**B-49 · The GM's question disappears while the trade desk thinks**
- Status: open
- Tier 2 · behaviour · Trades · size S · batch 4
- The GM sees: The draft is cleared on send and the question appears only when the answer arrives.
- Cause: PF/Trades/TradeDeskView.swift:211-217; PK/TradesStore.swift:249.
- Absorbs: OFF-30 (confirmed)

**B-50 · Wire injury lines name no injury**
- Status: open
- Tier 2 · data · Front Office, League Office · size S · batch 8
- The GM sees: "P 1053 was hurt" with the basis "Length, as the export records it: 12" and no unit.
- Cause: server/leagueWire.ts:320 reads only length and day_to_day (body_part and effect unused); server/presentation/frontOffice/wire.ts:108, :147.
- Absorbs: FO-10 (confirmed)

### Tier 3

**B-51 · Titles, labels and column heads are inconsistent**
- Status: open
- Tier 3 · words · All departments · size S · batch 10 · the phrasebook absorbs it
- The GM sees: "Position players" beside "Pitching Availability"; "Also worth a look (1)"; cryptic heads (T, P/3d, HLD, Brl%); "Coming in less going out"; "−<0.1 wins"; Every Contract keeps the payroll lede.
- Cause: server/presentation/majorLeague/views.ts:69, :283, :401, :443; PF/Finance/PayrollView.swift:38; trades payloads.
- Absorbs: MLB-44 (confirmed), MLB-45 (unchecked), MLB-51 (confirmed), MLB-52 (unchecked), MLB-59 (unchecked), OFF-32 (confirmed), OFF-37 (unchecked), OFF-40 (unchecked), OFF-41 (confirmed), FARM-42 (unchecked), FARM-43 (unchecked)

**B-52 · "the Club 1 N" and "him" for everyone**
- Status: open
- Tier 3 · words · League Office, Trades, Staff room, Player windows · size S · batch 10 · the phrasebook absorbs it
- The GM sees: "Ask him about the Club 1 N" (for Ana Frey too), "Meetings with the Club 4 N", "The Club 1 N's philosophy".
- Cause: server/presentation/ai/staffRoom.ts:82; server/presentation/league/usVsThem.ts:193-200; server/presentation/player/dossier.ts:713.
- Absorbs: FO-39 (confirmed), OFF-38 (confirmed)

**B-53 · Some words and numbers are written in the app instead of served**
- Status: open
- Tier 3 · words · Finance, MLB Ops · size S · batch 10 · the phrasebook absorbs it
- The GM sees: "N of M", "$", "million", "Weighing", "Available now (N)" and the depth plate's top-3 limit live in Swift.
- Cause: PF/Finance/ContractsView.swift:53; PF/Finance/PayrollView.swift:305, :314; PF/MajorLeague/DepthChartView.swift:180 vs server/presentation/clubhouse/depth.ts:16.
- Absorbs: OFF-42 (confirmed), MLB-57 (confirmed)

**B-54 · Drag and drop and "Open in New Window" fall short**
- Status: open
- Tier 3 · behaviour · Player windows, League Office (club windows) · size S · batch 5
- The GM sees: Dropping a player into Notes or Mail gives nothing; clubs can't be dropped on Compare; "Open in New Window" brings the existing window forward; Compare chips start blank with a stray focus ring.
- Cause: PK/Routing.swift:53-88 (private UTTypes only); PF/Player/CompareWindowView.swift:54; PF/FeatureCore/Attention.swift:256.
- Absorbs: FARM-38 (confirmed), FARM-45 (confirmed), FARM-44 (unchecked)

**B-55 · Small layout slips**
- Status: open
- Tier 3 · layout · MLB Ops, Finance, League Office, Player windows · size S · batch 9
- The GM sees: A Game Plan row with a missing cell shifts later cells into the wrong columns; a red "What-if" badge plus a "Scenario" badge; ratings bars 2 pt out of line; separate copies of the Office head with different spacing.
- Cause: PF/MajorLeague/ScheduleView.swift:147-157; PF/Player/PlayerRatingsTab.swift:63; Coaching Staff / Trades heads.
- Absorbs: MLB-55 (confirmed), MLB-50 (unchecked), FARM-46 (unchecked), OFF-46 (unchecked)

**B-56 · No automated check captures the Front Office report or a narrow Morning Report**
- Status: open
- Tier 3 · behaviour · Front Office · size S · batch 9
- The GM sees: CI's Front Office screenshot shows the GM Briefing, so layout slips there go unseen.
- Cause: macos UI tests (department-frontOffice.png capture).
- Absorbs: FO-38 (unchecked)

## Refuted

- **FO-19**: The app always asks the wire for followed-first (PK/LeagueStore.swift:62-65), so both pages show "Followed first, then newest"; the hunter's dump was fetched without the parameter.
- **FO-45**: The Go menu's built-in titles match the served department names today (macos/Pennant/Commands.swift:107-108); only a latent drift risk.
- **FO-49**: The department-card zeros are known zeros: Finance turns unknown when any contract is unsettled (server/presentation/frontOffice/finance.ts:104-126), and Medical counts come from real injury columns (medical.ts:66-96). Not a D-018 issue.
- **MLB-02**: "Active roster" counts the affiliate's active list (team_roster list_id 2, server/minorLeagueRoster.ts:227, :448), not its whole roster. Residual: the label doesn't name the club and leaves out injured and rehab men, so it won't match OOTP's own count.
- **MLB-14**: "0 arms flagged and notes on the pen" is only the VoiceOver label of a badge drawn when the count > 0 (PF/MajorLeague/StandingViews.swift:100-104); it's never on screen. Residual: the badge adds flagged arms and pen notes into one number.
- **FARM-05**: The farm starter counts are OOTP's exported role assignments (role 11, server/farmOperations.ts:1190), not usage, so 0 games doesn't void them; the synthetic farm clubs simply have no role-11 pitchers. The vacuous green "Every man has a spot" is kept with FARM-23 in "Farm pages open on empty filters".
- **FARM-30**: Age and service come straight from the export (server/player.ts:430, :451); the synthetic generator picks birth days independent of age (tests/syntheticSave.ts:296). "0 years" for 104-138 days is correct.
- **OFF-12**: The headline's hover explains the root-sum-of-squares combination and gives the all-at-once range −13.3 to +6.9 (server/presentation/trades/desk.ts:133, :411, :482-483), which is the house rule. Residual: that hover mentions "Phase 6b".

### Narrowed (the verdict stands, the claim is corrected)

- FO-06 (confirmed): the status does say "Key set, … (ends xxxx)"; the claim that nothing says set is wrong. What holds is the identical tone and symbol and the emptied field.
- FO-08 (confirmed): the hunter's suspected cause was wrong. The count includes the Farm 1 affiliate because human clubs are counted at every level. Whether a real OOTP save marks affiliates human is unknown.
- FO-20 (confirmed): "Most likely X · could be A to B" is the phrasing AGENTS.md prescribes, so that part is refuted. "every branch" and "half the time" are in hovers; "not separable" is visible.
- FO-28 (confirmed): hover moving the selection is normal Spotlight behaviour. The late-result jump and the 12-row cap stand.
- FO-29 (plausible): "Open in Player Search" sitting in the Players group is deliberate (searchWords.ts:48).
- OFF-30 (confirmed, question part): the AI isn't speaking as the user in the synthetic save. tradeVoice already swaps to the assistant GM when the names match exactly; that exact-name check is brittle.
- OFF-01: there are about 18 copies of the count helper, not 6.
- OFF-04: subtracting nulls gives 0, not NaN, so the unknown rows tie and keep SQL order, and are still ranked.
- OFF-19: the us/them columns are served as numeric (44/64 pt), not 110.
- OFF-21: Player Search's "Line at MLB, his busiest level" is a note on where the row's stats come from, not a heading missing its line; the card is still near-empty.
- FARM-09: real exports fill h/er/ha, so the impact on the real save is likely nil, but the code does turn unknown into zero.
- FARM-36: all six rows are visible at 900; "about 3 rows" overstates it, the three-column squeeze stands.
- MLB-60: the stacking is real, but the cause is ViewThatFits measuring unwrapped line widths, not 3 × 220.

## Round 2: deep code review items (B-57 onward)

From eleven deep code reviews of the server and the Mac app (2026-10-28); 240 findings, every H and M verified, merged by root cause. The reviews themselves are in [reviews/](reviews/).

Tier 1 = broken, wrong data, data loss, a doctrine or security breach. Tier 2 = wrong in edge cases, confusing, or a real performance or robustness problem. Tier 3 = polish, cleanup or retiring dead code. Within a tier, items run roughly in the order of the batch that fixes them.

### Tier 1

**B-57 · Choosing another save mixes the two saves' moves, dates and club**
- Status: open
- Tier 1 · data · All departments, Settings, Setup · size M · batch 1
- The GM sees: After picking another save (and before, or without, a successful import), the league on screen shows the other save's transactions, dates and save name; the followed club can carry over; a hand-picked save folder is ignored while Settings says it is in use; export watching switches itself on.
- Cause: The server locates 'the save' from settings, not from the import being served: server/api.ts:822-834, :840, :851 (chooseSave writes config first, returns early, starts the watcher unconditionally); server/dataStatus.ts:171-183, :411-429 (save location and live log from loadConfig()); server/history.ts:420 (currentSaveName from config) keying server/saveIdentity.ts:276-283; server/playerContext.ts:97, :127, :141; server/frontOfficeService.ts:288 (import key on config.json's stat); server/settings.ts:219-237 and server/clubOwed.ts:37 (club-forgotten and owed flags are process variables); server/ootpSave.ts:127-162 with server/api.ts:765 (hand-named folder tried last).
- Absorbs: SRVINFRA-01 (confirmed), SRVINFRA-04 (confirmed), SRVINFRA-19 (confirmed), SRVINFRA-25 (confirmed)

**B-59 · Notes, philosophy, budgets and AI writing are filed by club number, so they leak into another save**
- Status: open
- Tier 1 · data · Front Office, Philosophy & Staff, Player windows, Staff room, Finance · size L · batch 1
- The GM sees: Staff notes and the watchlist can appear on a different player in another save; a club's philosophy, next-season budget and theme carry over to the same-numbered club elsewhere; another save's briefing, storylines and Staff room chats appear and are sent to the AI; renaming the league makes Pennant forget the save's fitted history.
- Cause: server/history.ts:2025-2088, :420 (notes and watchlist keyed by the config's save name or 'unknown'); server/settings.ts:110-122 (philosophy, budget, theme keyed by String(teamId)); server/aiSurfacesService.ts:40-44 (AI files named by org id only); server/saveIdentity.ts:245-283 (identity = config name + hash of league name, first season and first 64 players). Re-keying needs a one-time data migration (owner decision).
- Absorbs: SRVINFRA-08 (confirmed), SRVINFRA-09 (confirmed), SRVINFRA-12 (confirmed), SRVSTATS-10 (confirmed)

**B-58 · A broken export or a half-written settings file can wipe the league or the GM's settings**
- Status: open
- Tier 1 · data · All departments, Settings · size M · batch 3
- The GM sees: An export with an empty players file replaces a good league with an empty one; a settings file caught mid-write silently resets and the next save erases philosophies, budgets and themes; an error just after the swap reports a failed import while the new data is already showing with stale leftovers.
- Cause: server/importWorker.ts:509-524 and server/importer.ts:208-211 (an empty file makes no table and is not refused; no check that players/teams/leagues exist); server/settings.ts:196-202, :239-241 (any parse error returns defaults; writers read-merge-write in place, not write-and-rename); server/importer.ts:309-318 with server/db.ts:196-207 (work after the rename can throw into runImport's catch, so caches are never cleared); server/importWorker.ts:309-316 (old tables may survive a rebuilt league).
- Absorbs: SRVINFRA-02 (confirmed), SRVINFRA-03 (confirmed), SRVINFRA-06 (confirmed), SRVINFRA-36 (unchecked)

**B-73 · After reloading an older save, the abandoned timeline still counts and contract history is deleted by it**
- Status: open
- Tier 1 · data · Finance, Trades · size S · batch 3
- The GM sees: Go back to an earlier save and the abandoned branch's contract pairs keep counting in the market price; the pruning that follows deletes snapshots by that wrong timeline and cannot be undone.
- Cause: server/playerValueSignings.ts:172-178 (segment starts at the new import's date, not the break's); server/playerValueSnapshot.ts:165 (the go-back pair is never formed); pruneContractSnapshots is irreversible.
- Absorbs: SRVVALUE-04 (proven)

**B-66 · Hidden true ratings still reach some pages**
- Status: open
- Tier 1 · doctrine · Trades, Scouting, Player windows, MLB Ops, Shell · size M · batch 4
- The GM sees: The Trade Desk shows true fielding grades (41 at short where our scouts say 75); with 'Show no player ratings' the player card still shows 50s, the roster grid grades and the staff stamina; Quick Open can list draft prospects OOTP hasn't revealed; when the export type is unknown, true ratings may win over OSA's.
- Cause: server/trade.ts:665 -> server/gloves.ts:100-106 (raw glove reader, not scoutedGloves); server/scoutedEvidence.ts:241, :362, :418 ('none' mode and unknown export type); server/search.ts:120-122 (filters only retired); tests/evidenceBoundary.test.ts GUARDED list misses history, pitching, player, roster, rosterops, valuation, trade.
- Absorbs: SRVDEV-01 (proven), SRVSTATS-01 (proven), SRVDEV-06 (proven), SRVSTATS-11 (confirmed), SRVDEV-09 (unchecked)

**B-67 · Numbers Pennant never measured in this save are labelled the league's own**
- Status: open
- Tier 1 · doctrine · MLB Ops, Farm, Player windows · size M · batch 4
- The GM sees: After the rating source changes, the old source's development lines are reused and labelled this save's; a role the save never measured shows the default number as the league's; glove weights are adopted as the league's own when they are only no worse than the default.
- Cause: server/stakesLinesRefit.ts:57-63 with server/saveCalibrationStore.ts:304; server/mlbCalibrationFit.ts:379 with server/roleStandards.ts:158-172; server/mlbCalibrationFit.ts:797 (passed: f >= p - tolerance) vs server/mlbCalibration.ts:139 decide(). Owner decision: glove weights under the detector, or an exemption.
- Absorbs: SRVDEV-02 (proven), SRVMLB-10 (confirmed), SRVMLB-11 (proven)

**B-64 · Major-league reports turn missing evidence into an answer**
- Status: open
- Tier 1 · doctrine · MLB Ops · size M · batch 5
- The GM sees: A send-down that may use a player's last option year is called routine; a player with no visible ratings and poor results is filed as 'results lag tools'; with no handedness data the bench report says nobody bats left and nobody bats right and invents needs; a follow-up names 'the weakest' when nobody can be compared; the thinnest position is judged on the backup; a player with no at-bats is treated as exactly average in the batting order.
- Cause: server/mlbResponses.ts:745-749 (unknown option charge -> routine); server/roleReview.ts:399-401, :477-483 (missing ratings count as fine); server/benchReview.ts (hands check and soft functions); server/mlbPlans.ts:131-137; server/positionNeeds.ts:43-49, :107; server/lineup.ts:588 (return 100 with no PA).
- Absorbs: SRVMLB-04 (proven), SRVMLB-06 (proven), SRVMLB-09 (proven), SRVSTATS-13 (confirmed), SRVMLB-15 (confirmed), SRVMLB-16 (unchecked)

**B-65 · Development reads unknowns as answers**
- Status: open
- Tier 1 · doctrine · Farm, Scouting, Player windows, Philosophy & Staff · size M · batch 5
- The GM sees: An unknown age profile makes a struggling player read as 'too advanced, still has developmental value'; an unknown pitch ceiling is shown as his current grade; rating history averages over missing tools; small leagues are told more games will settle a comparison that never can; philosophy can prefer 'stay' where Development says he has outgrown the level.
- Cause: server/currentAssignment.ts:276-299; server/player.ts:324; server/history.ts:546-557; server/farmResults.ts:360-364; server/assignmentPreference.ts:155-165 ('stay' always offered, not checked against the current-level read).
- Absorbs: SRVDEV-03 (proven), SRVDEV-15 (plausible), SRVFARM-17 (unchecked), SRVSTATS-20 (unchecked), SRVSTATS-21 (unchecked)

**B-62 · Postseason odds still steer the staff's advice and reach the AI**
- Status: open
- Tier 1 · doctrine · MLB Ops, Staff room, Trades, Finance · size M · batch 6
- The GM sees: With no club philosophy set, the odds quietly move the staff's act bar and the reason given is 'the window'; the needs list order shifts with the odds; the AI assistants can look up and repeat odds and buy/sell posture; the old web pages show playoff odds outside Standings.
- Cause: server/staffPreference.ts:96-123, :245-256 (odds fill in for a missing window); server/mlbReview.ts:309 (sort by odds-shaded severity); server/chat.ts:319-331 with server/dashboard.ts:383 (get_dashboard serves deadlineRead to the shared tools); server/clubFinanceRoutes.ts:38, server/ourViewRoutes.ts:46, src/pages/Payroll.tsx:529 (winValue). posture.ts is also read by server/playerValue.ts and server/mlbOperations.ts. Owner decisions: retire posture.ts from the decision path; does D-060 cover AI tool answers.
- Absorbs: SRVAI-02 (confirmed), SRVMLB-03 (proven), SRVMLB-13 (confirmed), SRVVALUE-10 (confirmed)

**B-63 · The AI writers are handed promotion calls, unknowns as zero and wrong labels**
- Status: open
- Tier 1 · doctrine · Staff room, Farm, Front Office · size S · batch 6
- The GM sees: The storylines writer is asked 'who is earning a promotion' without the briefing's farm rules; farm context sent to the AI carries readiness codes under a 'never a call-up' label and age 0 when unknown; the AI is told the prospect list is ranked when it is alphabetical; an unknown budget is given to it as zero.
- Cause: server/storylines.ts:260-265; server/farmOperations.ts:1295-1305; server/chat.ts:289-296 (list sorted by name at server/org.ts:749); server/valuation.ts:314-335.
- Absorbs: SRVAI-07 (confirmed), SRVAI-09 (confirmed), SRVFARM-23 (confirmed), SRVSTATS-22 (unchecked)

**B-74 · The old desktop app and the dev server accept commands from any website**
- Status: open
- Tier 1 · security · Shell · size M · batch 7
- The GM sees: On the Electron app, npm run dev and npm start, any web page can start paid AI writing, imports and site exports; reopening the Electron app from the Dock starts a second server; Electron itself has known security advisories. The Mac app is not affected (its server has a token).
- Cause: server/index.ts:38, :77-96 (Host check only); server/apiToken.ts:38-39 (no-op without a token; Electron sets none); express.json ignores text/plain bodies; electron/main.ts:128, :188-195, :257-278, :284-286; package-lock.json electron 41.10.4. Owner decision: retire Electron and the token-less mode now or at cutover.
- Absorbs: SRVINFRA-07 (confirmed), SRVHEALTH-06 (confirmed), SRVHEALTH-07 (confirmed), SRVHEALTH-16 (unchecked)

**B-75 · One bad request can crash the app's server**
- Status: open
- Tier 1 · behaviour · Staff room, Trades, All departments · size M · batch 7
- The GM sees: A malformed AI reply request gets no answer and the unhandled rejection can take the server down, including from Ask Staff; raw internal error messages reach the app; an odd sort value crashes the old player list.
- Cause: server/chat.ts:1182-1196, server/ai.ts:487, server/aiSurfacesService.ts:188 (async handlers outside try; Express 4 does not catch rejections); server/officeViewsBuild.ts:86 and server/v2Routes.ts:370-375 (err.message sent); server/league.ts:325, :335 (PLAIN_SORTS plain object); tests/request.ts:15 skips the real request checks.
- Absorbs: SRVHEALTH-01 (proven), SRVHEALTH-18 (unchecked), SRVPRES-14 (confirmed), SRVSTATS-29 (confirmed)

**B-60 · When the export is a day behind, dollar values vanish, or old pages keep saying they are current**
- Status: open
- Tier 1 · data · Finance, Front Office, League Office, Trades, Player windows · size M · batch 8
- The GM sees: On a 'behind' export every player loses his dollar value with the false reason 'No contract is a market price', while the Finance header still prices a win at about $2.1M; without the transaction log the Front Office never notices the save moved past the export; Org Comparison keeps an old 'up to date' build.
- Cause: Freshness is not passed consistently: server/playerRights.ts:1561 ('behind' blocks every eligibility) feeding server/playerValueFinances.ts marketStandingOf, while server/officeViewsBuild.ts:160 and server/clubFinanceRoutes.ts:29 call leagueFinances with no freshness; server/frontOfficeService.ts:157-160 (cache key ignores freshness when there is no live log); server/leagueViewService.ts:80, :117-120 (kept build not re-checked). Owner decision: should the price of a win depend on today's freshness?
- Absorbs: SRVPRES-01 (proven), SRVVALUE-02 (proven), SRVPRES-02 (proven)

**B-61 · Some numbers stay from the previous import until Pennant restarts**
- Status: open
- Tier 1 · data · All departments, Finance, Farm · size M · batch 8
- The GM sees: League batted-ball averages stay from the first import of the session; the measured market price, awards and renewals stay one import behind; a farm decision built during an import can mix old and new data and be kept; changing any setting, even a theme, rebuilds every department.
- Cause: Caches keyed on the wrong thing or never cleared: server/battedball.ts:63, :232 (clearBattedBallCache has no caller; clearLeagueCaches at server/api.ts:329-342 omits it); server/playerValue.ts:364, :834 keyed on server/playerValueContractStore.ts:95 (process-local counter the worker thread never bumps; server/api.ts:409-411 publishes import-finished before the hooks); server/playerValue.ts:1177 (leagueFacts cached by league only); server/farmViewService.ts:144-170 (no generation check after await); server/frontOfficeService.ts:287-289 (key on settings file stat).
- Absorbs: SRVINFRA-05 (confirmed), SRVPRES-03 (proven), SRVVALUE-01 (proven), SRVPRES-13 (confirmed), SRVVALUE-14 (unchecked)

**B-68 · A player's numbers are mixed across clubs and levels**
- Status: open
- Tier 1 · data · MLB Ops, League Office, Trades, Player windows, Scouting, Farm · size M · batch 9
- The GM sees: 'Who plays where' counts a traded player's games for his old club as ours (800 innings at short instead of 0); League Leaders leave out anyone sent down, released or moved; the Trade Desk adds minor and major league seasons together; the Game Plan credits at-bats to a pitcher's new club; Player Search can show a school season as the main stint; a two-club player gets one club's park; the player's 'this season' line can show only one club's share.
- Cause: Rows not filtered by club, level or league: server/resultsEvidence.ts:358-378; server/rosterops.ts:219, :256; server/trade.ts:607-611; server/gameplan.ts:111-115; server/league.ts:414-418 (no league_id != 0); server/farmResults.ts:261 (MIN(team_id)); server/presentation/player/dossier.ts:321-329 with server/player.ts:184.
- Absorbs: SRVMLB-01 (proven), SRVSTATS-02 (proven), SRVSTATS-06 (proven), SRVSTATS-07 (proven), SRVFARM-18 (confirmed), SRVPRES-09 (confirmed), SRVSTATS-17 (confirmed)

**B-69 · Spring, playoff and All-Star games are counted as the regular season**
- Status: open
- Tier 1 · data · MLB Ops, Farm, Front Office, Staff room · size M · batch 9
- The GM sees: Postseason odds count spring games as games left (42 instead of 12; a finished season reads 30); farm recent-usage reads count spring, playoff and last season's games; an All-Star appearance makes a player look newly arrived; the briefing counts spring games as form.
- Cause: No regular-season filter: server/posture.ts:135-140; server/farmUsage.ts:221-226, :314-327; server/farmRecentUsage.ts:132-138; server/storylines.ts:52, server/dashboard.ts:148.
- Absorbs: SRVMLB-02 (proven), SRVFARM-06 (proven), SRVFARM-07 (proven)

**B-70 · Some stat formulas are wrong or disagree between pages**
- Status: open
- Tier 1 · data · MLB Ops, Farm, League Office, Trades · size M · batch 9
- The GM sees: Strikeout pitchers in hitters' parks are rated worse instead of better; one pitcher's FIP differs between Rosters and the pitching staff; a 0.00 ERA sorts last and reads as unknown form; a tied game counts as a loss; none of the core formulas has a test.
- Cause: server/farmResults.ts:185-188, :382-384 (park factor applied the wrong way for strikeouts); server/roster.ts:280-283 vs server/trade.ts:600-602 (hit-batter term); server/stats.ts:293, server/pitching.ts:321, server/form.ts:120 (ERA+ undefined at 0.00); server/schedule.ts:111, server/trends.ts:69 (won: us > them); server/stats.ts computeBatting/computePitching untested beyond wRC+. Owner decision: how a 0.00 ERA's ERA+ reads and sorts.
- Absorbs: SRVFARM-01 (proven), SRVSTATS-04 (proven), SRVSTATS-05 (proven), SRVSTATS-32 (confirmed), SRVSTATS-25 (confirmed)

**B-71 · The farm miscounts who is on each roster and who can play where**
- Status: open
- Tier 1 · data · Farm · size M · batch 11
- The GM sees: Big-leaguers on rehab are reviewed and counted as farm players; the farm says nobody covers shortstop when a listed shortstop is there; a designated hitter can be treated as a catcher; room at a level is judged from one of its clubs.
- Cause: server/farmOperations.ts:773-884, :913-924 (rehab members counted); server/farmAffiliate.ts:247-255 with server/minorLeagueRoster.ts:301-308 (coverage ignores listed position); server/farmOperations.ts:288, :798 (teams[0]).
- Absorbs: SRVFARM-03 (proven), SRVFARM-04 (proven), SRVFARM-15 (confirmed), SRVFARM-16 (confirmed)

**B-72 · Contracts leaves out big-league contracts sent to the minors**
- Status: open
- Tier 1 · data · Finance · size M · batch 12
- The GM sees: An optioned 40-man player on a major-league deal, often in his arbitration years, is on Payroll but missing from Contracts' arbitration and option groups; an export missing the roster-status table makes Contracts fail with a database message.
- Cause: server/contracts.ts:436-441 (upstream roster-only population: p.team_id = orgId AND ON_ROSTER, unchecked join on players_roster_status and p.retired) vs server/playerValue.ts:486 payrollValuations; route check at server/contracts.ts:524-525. Rebuild on Payroll's population.
- Absorbs: SRVVALUE-03 (proven), SRVVALUE-12 (confirmed)

**B-76 · Long AI conversations grow until they fail**
- Status: open
- Tier 1 · behaviour · Staff room, Trades · size M · batch 16
- The GM sees: A long Staff room conversation keeps growing (540,000 characters stored, 400,000 sent) until every question fails; after about 20 questions it forgets what it already looked up; long trade-desk threads stop with 'request too large'.
- Cause: server/chat.ts:688-698, :742-752 (trimming never cuts), :701-704 with server/aiSurfacesService.ts:48, :110 (resume window); server/requestBody.ts:33 with PK/TradesStore.swift:233-241 (whole thread resent, default body limit).
- Absorbs: SRVAI-01 (proven), SRVAI-06 (proven), SRVHEALTH-02 (confirmed)

**B-77 · Slow AI answers fail on the Mac yet keep running, and costing, on the server**
- Status: open
- Tier 1 · behaviour · Staff room, Trades · size M · batch 16
- The GM sees: The AI desk and Staff room show 'Couldn't reach the Pennant server' on any answer that takes more than a minute, after the tokens are paid for; the server keeps running all paid turns after the app gives up; AI writing and key checks can hang for minutes with no way to stop them.
- Cause: PK/PennantClient.swift:35-44 (one URLSession, 60 s idle timeout); server/ai.ts:310-337, :502-509 (non-streaming tool loop, no abort on disconnect); server/chat.ts:825-857, :1238 (no keep-alive during thinking or between lookups); server/providers.ts:135, :178, :415 and server/ai.ts:585-590 (no timeout or maxRetries; key check races a timer). Owner decision: how long to wait and whether to cancel abandoned work.
- Absorbs: MACKIT-01 (confirmed), SRVAI-03 (proven), SRVAI-10 (confirmed), SRVAI-13 (unchecked)

### Tier 2

**B-98 · The app can miss updates after reconnecting, or a key saved right at launch**
- Status: open
- Tier 2 · behaviour · Shell, Settings · size S · batch 2
- The GM sees: Server events missed while the app reconnects are never caught up; an AI key handed over in the first moments of launch can be dropped.
- Cause: PK/AppModel.swift:738; server/sidecar.ts:84-113 (line listener attached after two awaits) with macos/Pennant ServerController.swift:266.
- Absorbs: MACKIT-06 (unchecked), MACKIT-07 (plausible)

**B-82 · Imports can stall, retry forever or refuse to start**
- Status: open
- Tier 2 · behaviour · Shell, Settings, Setup · size M · batch 3
- The GM sees: An export with future file times is never imported and OOTP is blamed; a stuck import can't be cancelled; after a crash and reboot Pennant may refuse to start, while two copies starting together can both run; a failed import is retried at every launch and called 'interrupted'; a refused import discards a running refit; numbers are stored as decimals so fallback names read 'Club 3.0'.
- Cause: server/exportFiles.ts:153-155 with server/importer.ts:177-190; server/importBuild.ts:98-122 (no timeout, no cancel route); server/dataLock.ts:38-46, :61-88 (pid reuse; rm-then-create race); server/api.ts:164-176, :402-411 (marker removed only for ImportRefused); server/api.ts:357 (generation bumped at start); server/importWorker.ts:206 (no column types; also server/positionNeeds.ts:96).
- Absorbs: SRVINFRA-14 (confirmed), SRVINFRA-15 (confirmed), SRVINFRA-16 (confirmed), SRVINFRA-17 (confirmed), SRVINFRA-21 (confirmed), SRVINFRA-24 (confirmed)

**B-89 · Fixed staffing floors and farm timings that should be measured per save**
- Status: open
- Tier 2 · doctrine · MLB Ops, Farm · size S · batch 4
- The GM sees: Small leagues are always told their pitching staff is critically short (fixed 5 SP / 7 RP / 2 C floors); farm timing settings were tuned on one save.
- Cause: server/mlbNeeds.ts:50-58 ('first-pass minimum'); server/farmCalibration.ts:144-164. Owner decision: fixed floors, floors from the league's active limit, or per-save measurement (D-053).
- Absorbs: SRVMLB-08 (proven), SRVFARM-24 (unchecked)

**B-90 · Changing OOTP's rating scale looks like player growth**
- Status: open
- Tier 2 · data · Scouting, Farm, Player windows · size S · batch 4
- The GM sees: Switch the save's rating scale (1-10 to 20-80) and every player's history shows a big jump.
- Cause: server/scoutedEvidence.ts:~1236 and server/history.ts (snapshots carry no scale). Owner decision: stamp the scale on each snapshot (a stored-data format change).
- Absorbs: SRVDEV-04 (proven)

**B-101 · Small security leaks: part of the AI key on disk, the settings file, stored keys**
- Status: open
- Tier 2 · security · Settings, Shell · size S · batch 7
- The GM sees: Part of each AI key (its length and last 6 characters) is written to a plain file; a Windows-style .env breaks keys and one in the data folder can flip test-only switches; saving a new key deletes the old one before the new one is stored; the app's server password would follow a malformed absolute link.
- Cause: server/unusable.ts:39; server/config.ts:36-48, server/sidecar.ts:28-31; PK/KeychainItems.swift:162-183; PK/PennantClient.swift:24-31.
- Absorbs: MACKIT-11 (confirmed), MACKIT-12 (confirmed), SRVAI-17 (confirmed), SRVINFRA-28 (confirmed), SRVSTATS-26 (confirmed)

**B-85 · Dates compared as text put events in the wrong order**
- Status: open
- Tier 2 · data · Player windows, Scouting, Medical · size S · batch 9
- The GM sees: The newest injury can drop off the player card; a player's trade and injury history can be out of order; the Draft Board compares dates its own way and can call a past date upcoming.
- Cause: OOTP dates are unpadded and must go through parseGameDate: server/player.ts:297; server/transactionHistory.ts:30, :55 (localeCompare; also unchecked columns); server/presentation/clubhouse/common.ts:97-100 with server/presentation/scouting/draftBoard.ts:316.
- Absorbs: SRVSTATS-09 (proven), SRVINFRA-23 (confirmed), SRVPRES-11 (confirmed)

**B-86 · Around the season rollover, pages disagree on which season is 'this season'**
- Status: open
- Tier 2 · data · MLB Ops, Farm, League Office, Trades, Finance · size M · batch 9
- The GM sees: In the offseason last season's numbers are read as this season's on some pages and not others; one reader falls back to the computer's calendar year.
- Cause: Ten MAX(year) reads where newer code uses season_year: server/roster.ts:158, lineup, pitching.ts:163, league, form, trade; server/farmOperations.ts:211-218; server/valuation.ts:231 (calendar year fallback).
- Absorbs: SRVFARM-12 (confirmed), SRVSTATS-12 (confirmed), SRVSTATS-23 (unchecked)

**B-91 · Openers vanish from the rotation, and other pitching-staff slips**
- Status: open
- Tier 2 · behaviour · MLB Ops · size S · batch 9
- The GM sees: A projected starter whose listed role isn't 'starter' (openers, stretched relievers) is missing from the rotation; raw role codes, 'of 3 used', an injured 'next man up' and an age off by one appear.
- Cause: server/pitching.ts:264; server/morningReport.ts; server/mlbEvidence.ts:629-655.
- Absorbs: SRVSTATS-08 (proven), SRVMLB-21 (unchecked)

**B-87 · The farm treats injured players as available, and a returning player as benched**
- Status: open
- Tier 2 · behaviour · Farm · size M · batch 11
- The GM sees: A player back from a long injury looks like he was benched; moving an injured player is blamed for a lineup hole he wasn't filling; organization depth and an incoming player's summary count injured men as available rivals; without a game log a promoted player's move date goes unused.
- Cause: server/farmUsage.ts:357; server/farmConsequence.ts:231, :411-440, :678; server/farmOrganization.ts:111 (OrgPlayerFact has no injured field); server/farmOperations.ts:490-501, :571-591.
- Absorbs: SRVFARM-05 (proven), SRVFARM-10 (confirmed), SRVFARM-11 (confirmed), SRVFARM-14 (confirmed), SRVFARM-20 (unchecked)

**B-88 · A free agent's market figure can go below the league minimum, even negative**
- Status: open
- Tier 2 · data · Finance · size S · batch 12
- The GM sees: Free Agents can show 'Could be -$1.7M to $14M' as what this league's market pays.
- Cause: server/playerValueSurplus.ts:625 (minimum + wins x price, edge against edge, no floor); server/presentation/finance/freeAgents.ts:73, :91. Owner decision: floor at the minimum, or re-word as production value.
- Absorbs: SRVVALUE-05 (confirmed)

**B-81 · With more than one human club, some features pick the wrong club**
- Status: open
- Tier 2 · behaviour · Staff room, Front Office, Trades · size S · batch 15
- The GM sees: In a league with several human managers, the assistant may read another club's standings and contracts, automatic AI writing can be about the wrong club, and trade and game-plan inboxes mix.
- Cause: server/chat.ts:525-534, :431 (human_team=1 LIMIT 1); server/api.ts:193, :219-228 (humanOrgId with no order, level filter or clubOwed check); server/trade.ts:399, :484; server/gameplan.ts:326.
- Absorbs: SRVAI-08 (confirmed), SRVINFRA-26 (confirmed), SRVSTATS-24 (unchecked)

**B-78 · AI answers that failed look finished**
- Status: open
- Tier 2 · behaviour · Staff room, Trades, Settings · size S · batch 16
- The GM sees: When the AI runs out of lookups it returns a blank answer marked as success; an answer cut off mid-sentence is shown and saved as complete; when a non-Claude AI declines, the Staff room doesn't say so; the key check says a Zen key works when the service is down.
- Cause: server/providers.ts:951-985, :960; server/chat.ts:842-891, :859-865, :965-976 (refused ignored); server/providers.ts:297-307; server/providers.ts:799 (repeated Gemini lookup ids, suspected).
- Absorbs: SRVAI-04 (proven), SRVAI-05 (proven), SRVAI-14 (confirmed), SRVAI-20 (confirmed), SRVAI-23 (unchecked)

**B-79 · AI model choices and defaults are out of date**
- Status: open
- Tier 2 · outdated · Staff room, Settings · size S · batch 16
- The GM sees: New Gemini users' first request fails (the default model 404s for new keys); the model list is out of date and newer Claude models may refuse follow-ups after history rewriting; the default is the most expensive Claude model; a failing model-list lookup is retried before every question; the old chat names Anthropic for any missing key; local Ollama models may silently drop history.
- Cause: server/providers.ts:452, :336-344; server/models.ts:39-43, :136-140; server/chat.ts:762-770, :945, :113, :1073; server/settings.ts:140, :159-168 (DEFAULTS.model claude-opus-5 masks DEFAULT_MODEL); server/providers.ts:250-254. Owner decision: default model.
- Absorbs: SRVAI-11 (plausible), SRVAI-12 (plausible), SRVAI-18 (confirmed), SRVAI-19 (confirmed), SRVAI-21 (confirmed), SRVINFRA-27 (confirmed)

**B-80 · Automatic AI writing runs, and costs, more often than needed**
- Status: open
- Tier 2 · perf · Front Office, Staff room · size S · batch 16
- The GM sees: With auto-writing on, every daily export pays for two AI writes even when the game date hasn't moved; restarting after an unfinished import can pay for them again.
- Cause: server/api.ts:188-212 (no game-date guard); server/postImport.ts:21 (fresh flag never read), server/api.ts:576. Owner decision: skip when the game date is unchanged.
- Absorbs: SRVAI-22 (plausible), SRVINFRA-34 (confirmed)

**B-83 · Names with accents and symbols come in garbled**
- Status: open
- Tier 2 · data · All departments, Player windows · size S · batch 17
- The GM sees: Names with Š, Ž, curly quotes or € are imported garbled and don't match the transaction log. Fixing the decoding naively could split a player's rating history in two.
- Cause: server/importWorker.ts:144 and server/saveDiscovery.ts (latin1 fallback) vs server/transactionLog.ts:279-294 (windows-1252); server/historyIdentity.ts:103-107 (looseName strips the control byte, so a fixed name may stop matching its history).
- Absorbs: SRVINFRA-13 (confirmed), SRVSTATS-31 (plausible)

**B-84 · Exports missing a table or column break whole pages, and a looping club tree could hang the server**
- Status: open
- Tier 2 · behaviour · Farm, MLB Ops, Medical, Scouting, Front Office, Finance · size M · batch 17
- The GM sees: On older or unusual saves the whole farm section, the pitching staff and the draft board fail; the briefing and storylines break; a missing stat column silently stops the league's own standards from ever being measured; a hurt player with no roster-status row is missing from the Injury Report; a malformed club hierarchy loops forever.
- Cause: Unchecked columns and tables: server/destinationFit.ts:560-600; server/pitching.ts:131; server/rosterops.ts:844-860; server/stats.ts:159-161; server/mlbCalibrationRefit.ts:228-232 (throw swallowed at server/saveCalibration.ts:142); server/dashboard.ts:43; server/health.ts:60-63, :205-212 (NULL predicate on a missing LEFT JOIN row); recursive affiliate queries with no loop guard at server/farmOperations.ts:137-148 (+3 copies), server/org.ts:131, server/scoutedDevelopment.ts:99.
- Absorbs: SRVDEV-05 (proven), SRVFARM-08 (proven), SRVFARM-13 (proven), SRVINFRA-20 (confirmed), SRVAI-16 (unchecked), SRVDEV-11 (confirmed), SRVMLB-17 (confirmed), SRVSTATS-27 (confirmed)

**B-92 · The prospect and development reads are redone many times per page**
- Status: open
- Tier 2 · perf · Farm, MLB Ops, Player windows · size M · batch 18
- The GM sees: Farm pages run the prospect pass twice per load and many times per import; one farm problem blanks all five farm pages; MLB reports redo the prospect assessment for every development question; some pages reload all rating history (3 s at 300,000 rows) repeatedly; opening one decision rebuilds the whole club review.
- Cause: server/farmViewsBuild.ts:89-127, :100; server/org.ts:879 with server/mlbResponses.ts:1195 (computeProspects, no memo); server/developmentalContext.ts:212-224; server/rosterStateHistory.ts:418; server/mlbReview.ts:319-321.
- Absorbs: SRVDEV-07 (proven), SRVFARM-09 (proven), SRVPRES-04 (proven), SRVSTATS-15 (confirmed), SRVDEV-13 (unchecked), SRVMLB-19 (unchecked)

**B-93 · Background page building falls back to slow and stays slow**
- Status: open
- Tier 2 · perf · All departments · size S · batch 18
- The GM sees: One failed department build moves every later build onto the main thread for the rest of the session; each build starts a fresh helper; every answer is re-validated on each request.
- Cause: server/frontOfficeService.ts:236-249, :262-272 (workerBroken set on any rejection, never reset), :203-219; server/v2Routes.ts:84-87.
- Absorbs: SRVINFRA-11 (confirmed), SRVINFRA-33 (unchecked), SRVPRES-17 (unchecked)

**B-94 · Growing histories are reread in full on every visit**
- Status: open
- Tier 2 · perf · Finance, Front Office, Shell · size M · batch 18
- The GM sees: The market history adds about 30 KB per import and is read whole (twice) on every Finance load; the news wire rereads all trade and injury history; reading the game's log can freeze the app for seconds; the once-a-minute save check sometimes rescans every save; imports load whole files into memory.
- Cause: server/playerValueSnapshot.ts:314-341 with server/clubFinanceRoutes.ts:34-36 and server/officeViewsBuild.ts:161; server/leagueWire.ts:297, :320; server/dataStatus.ts:302-332 and server/playerStateRoutes.ts:47-58 (synchronous read, Atomics.wait); server/saveDiscovery.ts:153-163; server/importWorker.ts:108-140, :461-476.
- Absorbs: SRVINFRA-18 (confirmed), SRVSTATS-14 (confirmed), SRVVALUE-06 (confirmed), SRVINFRA-22 (unchecked), SRVINFRA-32 (unchecked)

**B-95 · Player Search sorted by a stat slows sharply and then fails on big leagues**
- Status: open
- Tier 2 · perf · Scouting · size S · batch 18
- The GM sees: Sorting Player Search by a stat goes from 15 ms to 279 ms at 4,800 players, 3.3 s at 20,000, and fails with 'too many SQL variables' past about 32,000 matches.
- Cause: server/league.ts:392-396, :403, :422 (computePlayers: lookup inside the loop and every id bound as a variable; rank in SQL or from a per-import table).
- Absorbs: SRVPRES-05 (proven), SRVSTATS-03 (proven)

**B-97 · Undo, notes and a few commands misbehave**
- Status: open
- Tier 2 · behaviour · Player windows, Trades, Philosophy & Staff, Staff room · size M · batch 19
- The GM sees: Undoing 'Remove Staff Note' breaks Redo and Cmd-Z removes it again; quitting while the server is down loses unsaved notes; closed windows' undo history is never freed; dragging a philosophy slider can save twice; 'Ask Staff About Him' can silently do nothing; Clear Deal can't be undone.
- Cause: PK/PlayerStore.swift:441-453 (re-remove registered inside a Task), :207-210 (takeUnsaved then guard client); PK/Attention.swift:74, PK/PhilosophyStore.swift:270 (strong undoManager captures); PF/Philosophy/OrganizationalPhilosophyView.swift:287-308; PF/Shell/StaffRoomScene.swift:165-176; PF/Trades/TradeDeskView.swift:61-70.
- Absorbs: MACKIT-04 (confirmed), MACKIT-09 (confirmed), MACKIT-08 (confirmed), MACUI-11 (plausible), MACUI-15 (confirmed), MACUI-17 (unchecked)

**B-96 · VoiceOver and keyboard users miss numbers and choices**
- Status: open
- Tier 2 · behaviour · All departments, Farm, Front Office · size M · batch 20
- The GM sees: VoiceOver reads a figure's label but never its number, and never a roster plate's Need flag, value or place; some drop-downs are the kind VoiceOver struggles with; the chosen farm club is shown only by colour; 'Not known' goes faint on a highlighted row; VoiceOver's desk actions don't match the menus; Tab stops on every figure and name, and clicks show focus rings.
- Cause: PD/Depth.swift:62-73 (ClaimText's accessibilityLabel replaces the value), :64 (.focusable()); PD/RosterDiagram.swift:247-298; PF/League/WireView.swift:63-90; PF/Farm/FarmAffiliatesView.swift:62-90; PF/MajorLeague/Components.swift:35-36; PF/FeatureCore/FrontOfficeViews.swift:149-159; PF/FeatureCore/Attention.swift:249, :294.
- Absorbs: MACUI-01 (confirmed), MACUI-12 (unchecked), MACUI-13 (confirmed), MACUI-14 (unchecked), MACUI-21 (confirmed), MACUI-22 (confirmed)

**B-100 · The AI staff's lookups go through the old web addresses**
- Status: open
- Tier 2 · outdated · Staff room, Trades · size M · batch 23
- The GM sees: Nothing visible today, but deleting the old web routes would silently break 17 of the AI staff's lookups; the lookups call the server over HTTP with no timeout and an assumed local address.
- Cause: server/chat.ts:122-131 (callOwnApi), :407-506 (17 routes). Rewrite the tools to call services directly before any route is retired.
- Absorbs: SRVHEALTH-08 (confirmed)

**B-99 · Tests that check nothing, or never run**
- Status: open
- Tier 2 · test-gap · All departments · size M · batch 24
- The GM sees: The farm-to-majors link tests return early on an empty test farm (11 checks do nothing); tests are never type-checked (98 errors); expected outputs are rewritten wholesale; test data lacks real export columns; farm safety tests skip files; about 34 sample answers are decoded by no Mac test; a market-record test checks the start-up path, not the import's; several code-comment promises have no test.
- Cause: tests/farmMlbIntegration.test.ts and farm windowed invariants (if (!him) return); tsconfig.json:21 include omits tests; tests/contract.test.ts:296-304; tests/fixture.ts:263; tests/farmOperationsBoundary.test.ts:23-38; server/farmOperations.ts:711; contract/fixtures/responses (keep the decode-every-fixture Swift test); tests/playerValueBoundary.test.ts:704-711; server/importCache.ts:9, server/health.ts:205.
- Absorbs: SRVHEALTH-03 (proven), SRVHEALTH-04 (proven), SRVFARM-21 (unchecked), SRVFARM-22 (unchecked), SRVHEALTH-14 (unchecked), SRVINFRA-35 (unchecked), SRVMLB-20 (unchecked), SRVPRES-12 (confirmed), SRVVALUE-07 (unchecked)

**B-102 · Libraries, Node and the web framework are out of date**
- Status: open
- Tier 2 · outdated · All departments · size M · batch 24
- The GM sees: Libraries carry 14 known advisories (3 critical, 7 high); major libraries are behind; the required Node version isn't declared, and running from source on Node 20/22 quietly skips the background work; the main checkout's installed libraries are stale.
- Cause: package.json (no engines; Express 4), package-lock.json; README.md:119 ('Node 20+'); server/frontOfficeService.ts:187-193 (workerAvailable). Owner decision: declare Node 24 and when to move to Express 5.
- Absorbs: SRVINFRA-10 (plausible), SRVHEALTH-12 (confirmed), SRVHEALTH-13 (unchecked), SRVHEALTH-20 (confirmed)

### Tier 3

**B-105 · Value notes assume a 162-game season and that level 1 is the majors**
- Status: open
- Tier 3 · behaviour · Finance, Player windows · size S · batch 12
- The GM sees: The value-of-a-win explanation gives a wrong 'pace' in 60-, 100- or 154-game leagues; in a league whose top level isn't 1, a blank-row major leaguer's later seasons read unknown.
- Cause: server/playerValueWinValue.ts:103 (talent * 162); server/playerValue.ts:305 (level === 1, use marketLevels()).
- Absorbs: SRVVALUE-08 (confirmed), SRVVALUE-09 (confirmed)

**B-103 · Old web-only addresses and the website export to retire**
- Status: open
- Tier 3 · dead-code · All departments · size M · batch 23
- The GM sees: Ten server addresses nothing calls, a long list used only by the old web pages, a value address that ignores freshness, logos fetched for the web only, and a website export that leaks folder paths and can overwrite an earlier export.
- Cause: server/trade.ts:535, server/playerValueRoutes.ts:31-35, farmRoutes.ts; the old-web-only list in scratchpad/deep/srvhealth-out/diff.txt; server/logos.ts:15-56; server/exporter.ts:125-130, :200-205. Owner decision: which go now and which at cutover (B-100 first).
- Absorbs: SRVHEALTH-09 (confirmed), SRVHEALTH-10 (unchecked), SRVINFRA-30 (unchecked), SRVINFRA-31 (confirmed), SRVVALUE-11 (confirmed)

**B-104 · Leftover code, scripts and settings**
- Status: open
- Tier 3 · dead-code · All departments · size S · batch 23
- The GM sees: An old config file is read forever and an unused setting lingers; duplicate lookup tables disagree; unused code and misleading comments; build leftovers could be committed; the owner-experiment scripts are still there and a benchmark script has no guard against the real data folder; a display switch in the shared table is dead.
- Cause: server/config.ts:27-32, :63-72; server/valuation.ts:241, server/stats.ts:308; server/roleStandards.ts:192-204; server/farmOperations.ts:529, :718, :828; .gitignore:7-13; scripts/rights-experiment.ts, rights:* scripts, scripts/bench-import.mjs:24; PF/FeatureCore/OfficeKit.swift:36.
- Absorbs: MACUI-09 (confirmed), SRVFARM-25 (unchecked), SRVHEALTH-11 (unchecked), SRVHEALTH-15 (confirmed), SRVHEALTH-17 (confirmed), SRVINFRA-29 (confirmed), SRVSTATS-30 (unchecked)

**B-106 · Some labels overstate or misplace what is known**
- Status: open
- Tier 3 · words · MLB Ops, Player windows · size S · batch 25 · phrasebook
- The GM sees: A blended estimate is called 'visible tools'; plan titles read as orders ('Designate X'); the card says 'Not optioned this season' for a player optioned today; a missing row is blamed on OOTP.
- Cause: server/mlbReport.ts:182-185, :421-423; server/mlbPlans.ts titles; server/presentation/player/dossier.ts:297; server/playerState.ts:157-160.
- Absorbs: SRVDEV-10 (confirmed), SRVDEV-14 (unchecked), SRVMLB-12 (unchecked), SRVMLB-18 (unchecked)

## Round-1 items that gained findings

These findings extend an existing item and do not become a new one. The batch shown is the new plan's.

- **B-01** (Hover notes show developer details and a developer's local save; batch 13): SRVPRES-06 (proven)
- **B-02** (Missing stats are shown as zero; batch 5): SRVAI-15 (confirmed), SRVDEV-12 (unchecked), SRVPRES-10 (confirmed), SRVSTATS-18 (unchecked), SRVSTATS-19 (unchecked), SRVSTATS-28 (unchecked)
- **B-06** (Counts and plurals read wrong ("Started 1 games", "2076"); batch 10): SRVHEALTH-05 (proven), SRVHEALTH-19 (confirmed), SRVVALUE-13 (confirmed)
- **B-07** (Another save's farm, players and notes stay on screen after a switch; batch 2): MACKIT-03 (confirmed), MACKIT-02 (confirmed), MACKIT-05 (confirmed), MACUI-06 (confirmed), MACKIT-13 (confirmed)
- **B-08** (Pages can get stuck on Loading or keep an old error; batch 2): MACUI-03 (confirmed)
- **B-12** (Pages say all is well when nothing has been read; batch 5): SRVFARM-02 (proven)
- **B-13** (Counts show zero when the list isn't known, and unpriced contracts drop out of totals; batch 5): SRVPRES-07 (confirmed), SRVFARM-19 (unchecked)
- **B-14** (A saved AI key looks the same as no key; batch 21): MACKIT-10 (confirmed)
- **B-17** (The only catcher is counted as his own backup; batch 5): SRVMLB-07 (proven)
- **B-21** (The Trade Desk weighs trades that can't happen; batch 15): SRVSTATS-16 (confirmed), SRVPRES-16 (confirmed)
- **B-22** (Draft Board sorting only sorts the first 300 players; batch 15): SRVPRES-08 (unchecked)
- **B-25** (A Decision promises things that aren't there; batch 14): SRVMLB-05 (proven), SRVMLB-14 (confirmed)
- **B-32** (Payroll room and payroll differ between Finance pages; batch 12): SRVPRES-15 (confirmed)
- **B-34** ("Whose ratings" reads Not known, with no way forward; batch 4): SRVDEV-08 (confirmed)
- **B-36** (Pages forget or ignore where you were; batch 2): MACUI-07 (plausible), MACUI-08 (confirmed), MACUI-10 (unchecked), MACUI-16 (confirmed), MACUI-18 (confirmed)
- **B-37** (Farm rows and player windows lack the usual Mac controls; batch 19): MACUI-02 (confirmed), MACUI-05 (confirmed)
- **B-40** (Settings hides choices and state; batch 21): MACUI-23 (confirmed)
- **B-41** (Sidebar badges, the menu bar and the widget; batch 19): MACKIT-14 (confirmed)
- **B-42** (Quick Open can open the wrong thing; batch 19): MACUI-04 (confirmed)
- **B-45** (Heavy work on every redraw; batch 19): MACUI-20 (unchecked)
- **B-53** (Some words and numbers are written in the app instead of served; batch 25): MACUI-19 (confirmed)

## Refuted or narrowed (round 2)

No finding was refuted outright. Parts of these claims did not hold, or were narrower than reported; each item keeps the part that stands:

- **SRVPRES-09**: the level names do cover levels 10 and 11, so the "unlisted level" half is narrower than claimed; the traded-player half (one club's share shown as the season) stands.
- **SRVPRES-11**: `dayOrder` handles unpadded dates; only an unreadable format misfires. It still breaks the parseGameDate rule.
- **SRVAI-11**: Ollama's chat truncation usually keeps system messages, so the guardrails are probably not what gets lost; history and tool results are.
- **SRVAI-12**: the history rewriting and the stale model lists are confirmed; the claim that newer Claude models answer 400 on edited history rests only on the skill text (PLAUSIBLE).
- **SRVAI-02**: the code does serve odds and posture to the AI tools, but D-060 as written covers the landing page; extending it is an owner call.
- **SRVFARM-07**: proven in code; whether real exports carry All-Star rows that way is unconfirmed.
- **MACKIT-03**: the mechanism is confirmed; how an unsaved draft survives into the switch (a refused save) is unverified.
- **MACKIT-01**: confirmed by reading; the over-60-second trigger was not run (the reviewer's sandbox blocked loopback).
- **MACUI-09**: confirmed, but nothing passes `chip: false` yet, so nothing visible is wrong today (filed as dead code).

## Fix batches (covering B-01 to B-106)

Each batch is one PR and fixes one root cause or one module family everywhere it appears. Order: (a) data loss, save switching and identity, and doctrine breaches (batches 1 to 7); (b) correctness (8 to 15); (c) robustness and performance (16 to 18); (d) Mac behaviour and accessibility (19 to 22); (e) retire and modernise (23 and 24); (f) words and the phrasebook (25). Round 1's batch numbers are replaced by these.

### Batch 1 · The served save is the only save
- What: The server serves one save end to end: save location, live log, identity and every GM input are keyed to the save actually imported, with a one-time migration of notes, watchlist, philosophy, budgets, themes and AI files.
- Size L · depends on: nothing · owner decision first: Re-key stored GM data by save id with a one-time migration, and move save identity off the name and player fingerprint without orphaning fitted history.
- Items: B-57 Choosing another save mixes the two saves' moves, dates and club; B-59 Notes, philosophy, budgets and AI writing are filed by club number, so they leak into another save

### Batch 2 · Mac stores and pages follow the save
- What: Every Mac store, draft note, pinned item and page state resets or is held per save on a switch; newest-refresh-wins; failed loads and choices never strand a view; reconnects catch up.
- Size M · depends on: batch 1 · owner decision first: After a save switch, are unsaved notes discarded or held for that save and offered back?
- Items: B-07 Another save's farm, players and notes stay on screen after a switch; B-08 Pages can get stuck on Loading or keep an old error; B-36 Pages forget or ignore where you were; B-48 The payroll budget box silently throws away what you type; B-49 The GM's question disappears while the trade desk thinks; B-98 The app can miss updates after reconnecting, or a key saved right at launch

### Batch 3 · Imports and settings never lose data
- What: Validate an export before the swap, write settings atomically and refuse to overwrite an unreadable file, make the contract-history timeline and pruning reload-safe, and make imports cancellable, lock-safe and honest about failures.
- Size M · depends on: nothing · owner decision first: Should an unreadable settings file block writes until the GM confirms (recommended: keep a backup and refuse to overwrite)?
- Items: B-58 A broken export or a half-written settings file can wipe the league or the GM's settings; B-73 After reloading an older save, the abandoned timeline still counts and contract history is deleted by it; B-82 Imports can stall, retry forever or refuse to start

### Batch 4 · Our scouts' ratings and our own measurements only
- What: Close the remaining fog-of-war leaks (trade gloves, 'none' mode, unrevealed draft, unknown export type), widen the boundary test to the whole server, label only measured numbers as the league's own, put glove weights under the detector, and stamp the rating scale on snapshots.
- Size L · depends on: nothing · owner decision first: What 'Show no player ratings' shows; whether unrevealed draft prospects can be searched; glove weights under the detector or an exemption; fixed or per-save coverage floors; stamping the rating scale on snapshots.
- Items: B-34 "Whose ratings" reads Not known, with no way forward; B-66 Hidden true ratings still reach some pages; B-67 Numbers Pennant never measured in this save are labelled the league's own; B-89 Fixed staffing floors and farm timings that should be measured per save; B-90 Changing OOTP's rating scale looks like player growth

### Batch 5 · Unknown stays unknown
- What: Stop turning missing stats, counts, ratings, option charges, handedness and age profiles into zeros, averages or verdicts, server-wide, in the stats layer and in MLB and Development reads.
- Size L · depends on: nothing · owner decision first: When some salaries are missing, does payroll room read 'At most $X free' with a caution tone?
- Items: B-02 Missing stats are shown as zero; B-12 Pages say all is well when nothing has been read; B-13 Counts show zero when the list isn't known, and unpriced contracts drop out of totals; B-17 The only catcher is counted as his own backup; B-64 Major-league reports turn missing evidence into an answer; B-65 Development reads unknowns as answers

### Batch 6 · Odds and promotion calls out of advice and the AI
- What: Take posture.ts out of MLB's decision path and Player Value, keep odds to Standings, remove odds and posture from the AI tools, and give the AI writers the farm and value guardrails with true labels.
- Size M · depends on: nothing · owner decision first: Retire posture.ts from the decision path, and does D-060 also bar odds and buy/sell from AI tool answers?
- Items: B-62 Postseason odds still steer the staff's advice and reach the AI; B-63 The AI writers are handed promotion calls, unknowns as zero and wrong labels

### Batch 7 · Close the open server and the crash class
- What: Require a token (or same-origin plus JSON-only) on every server mode, fix Electron's double start and bump it, catch every async handler and stop sending raw errors, and close the small key and settings-file leaks.
- Size M · depends on: nothing · owner decision first: Retire Electron and the token-less mode now, or keep it patched until cutover?
- Items: B-74 The old desktop app and the dev server accept commands from any website; B-75 One bad request can crash the app's server; B-101 Small security leaks: part of the AI key on disk, the settings file, stored keys

### Batch 8 · Freshness and caches agree
- What: One freshness source threaded to every reader and builder; caches keyed on the import generation and the served save, cleared after the post-import hooks; one byline for 'today'.
- Size M · depends on: batch 1 · owner decision first: Should the price of a win depend on today's freshness (recommended: no, measure it from last winter's signings)?
- Items: B-26 Pages disagree on today's date and how fresh the data is; B-60 When the export is a day behind, dollar values vanish, or old pages keep saying they are current; B-61 Some numbers stay from the previous import until Pennant restarts

### Batch 9 · Which rows count, and how stats are computed
- What: Filter every stat read by club, level, league and regular season; one 'this season'; parseGameDate everywhere; one tested formula module for FIP, ERA+, park factors and results.
- Size L · depends on: nothing · owner decision first: How a 0.00 ERA's ERA+ reads and sorts.
- Items: B-68 A player's numbers are mixed across clubs and levels; B-69 Spring, playoff and All-Star games are counted as the regular season; B-70 Some stat formulas are wrong or disagree between pages; B-85 Dates compared as text put events in the wrong order; B-86 Around the season rollover, pages disagree on which season is 'this season'; B-91 Openers vanish from the rotation, and other pitching-staff slips

### Batch 10 · One number, money and count formatter
- What: A single shared helper for counts, plurals, ordinals, thousands, money, minus signs, dashes and innings, replacing the local copies.
- Size M · depends on: nothing · owner decision first: no
- Items: B-06 Counts and plurals read wrong ("Started 1 games", "2076"); B-09 Innings are written as decimals (10.7 instead of 10.2)

### Batch 11 · Farm rosters and injuries
- What: Rehab big-leaguers, listed positions, every club at a level and the injured list read correctly in the farm's rosters, depth, consequences and usage.
- Size M · depends on: batch 9 · owner decision first: no
- Items: B-71 The farm miscounts who is on each roster and who can play where; B-87 The farm treats injured players as available, and a returning player as benched

### Batch 12 · Finance and value correctness
- What: Contracts on Payroll's population, one payroll-room and budget definition, a free-agent market figure that respects the minimum, season length and top level from the league.
- Size M · depends on: batch 8 · owner decision first: Floor a free agent's market figure at the minimum or re-word it; what budget the years after next season use.
- Items: B-32 Payroll room and payroll differ between Finance pages; B-72 Contracts leaves out big-league contracts sent to the minors; B-88 A free agent's market figure can go below the league minimum, even negative; B-105 Value notes assume a 162-game season and that level 1 is the majors

### Batch 13 · No developer or code text on screen
- What: GM-facing lines for calibration stamps, no level ids or column names in served text, and a jargon test that covers hovers and bases.
- Size M · depends on: nothing · owner decision first: no
- Items: B-01 Hover notes show developer details and a developer's local save; B-11 Code words reach the screen ("level 2", column names)

### Batch 14 · Decision pages
- What: Dedupe, name the player, compose each reason once, file clearing options correctly, and make the clubhouse pages agree.
- Size L · depends on: batch 5 · owner decision first: no
- Items: B-16 The same player appears twice on a Decision; B-18 Farm findings don't name the player; B-23 Decision pages say the same thing two or three times; B-24 Decision pages contradict themselves; B-25 A Decision promises things that aren't there; B-35 Clubhouse pages disagree on who plays where and how good he is

### Batch 15 · Facts agree across pages
- What: Current 'later version' list, correct club links, trade validity and partners, server-side sorting, staff roles and the human-GM check, philosophy summary, wire injuries, and the right club when several are human.
- Size L · depends on: nothing · owner decision first: no
- Items: B-19 The Morning Report says four departments "come in a later version"; B-20 A farm player's club link opens the big-league club; B-21 The Trade Desk weighs trades that can't happen; B-22 Draft Board sorting only sorts the first 300 players; B-33 Staff titles differ between pages, and the GM's report may be credited to someone else; B-47 The philosophy summary contradicts itself when nothing is set; B-50 Wire injury lines name no injury; B-81 With more than one human club, some features pick the wrong club

### Batch 16 · The AI staff
- What: Bounded conversation history, streaming with heartbeats and server-side cancel, honest failed or cut-off answers, current models and defaults, and auto-writing only when the game date moves.
- Size L · depends on: batch 7 · owner decision first: How long the app waits for an AI answer and whether abandoned work is cancelled; default Claude model; skip auto-writing when the game date is unchanged; offer newer models before the history check?
- Items: B-76 Long AI conversations grow until they fail; B-77 Slow AI answers fail on the Mac yet keep running, and costing, on the server; B-78 AI answers that failed look finished; B-79 AI model choices and defaults are out of date; B-80 Automatic AI writing runs, and costs, more often than needed

### Batch 17 · Unusual exports and names
- What: Schema-tolerant reads for every table and column, loop-safe club hierarchy, LEFT JOIN nulls handled, and windows-1252 decoding with a history-safe name match.
- Size M · depends on: batch 3 · owner decision first: no
- Items: B-83 Names with accents and symbols come in garbled; B-84 Exports missing a table or column break whole pages, and a looping club tree could hang the server

### Batch 18 · Compute once per import
- What: Memoise the prospect and development passes per import, keep the worker healthy, summarise growing histories, and rank Player Search in SQL.
- Size M · depends on: batch 8 · owner decision first: no
- Items: B-92 The prospect and development reads are redone many times per page; B-93 Background page building falls back to slow and stays slow; B-94 Growing histories are reread in full on every visit; B-95 Player Search sorted by a stat slows sharply and then fails on big leagues

### Batch 19 · Sidebar, tables and Mac commands
- What: Mac sidebar behaviour, one shared table with hidden-row-safe commands and published focus, farm filters, Quick Open, menu bar and widget, drag and drop, undo and notes, and less per-redraw work.
- Size L · depends on: batch 2 · owner decision first: Should Clear Deal be undoable, and should the inspector get an Unpin control (recommended: yes to both)?
- Items: B-03 The sidebar doesn't respond like a Mac sidebar; B-37 Farm rows and player windows lack the usual Mac controls; B-38 Farm pages open on empty filters; B-41 Sidebar badges, the menu bar and the widget; B-42 Quick Open can open the wrong thing; B-45 Heavy work on every redraw; B-54 Drag and drop and "Open in New Window" fall short; B-97 Undo, notes and a few commands misbehave

### Batch 20 · Accessibility
- What: Spoken values for every figure and roster plate, standard pop-up menus, selected traits not colour alone, matching VoiceOver actions, and fewer Tab stops; add label and value tests.
- Size M · depends on: batch 19 · owner decision first: no
- Items: B-96 VoiceOver and keyboard users miss numbers and choices

### Batch 21 · Settings, Setup and the transaction-log fix
- What: Data Status points to the fix, a set AI key looks set and a blank one is refused, Settings exposes its choices and a valid club picker, Setup counts clubs the way the club list does.
- Size M · depends on: nothing · owner decision first: no
- Items: B-05 "Transaction history unavailable" never says how to fix it; B-14 A saved AI key looks the same as no key; B-39 Setup contradicts itself and doesn't guide; B-40 Settings hides choices and state

### Batch 22 · Tables, heads and layout
- What: Per-column widths and full-text hovers, heads that wrap, roster-map z-order, empty states, narrow and inspector layouts, charts, and CI captures for the missing views.
- Size L · depends on: batch 19 · owner decision first: no
- Items: B-04 Table text is cut off and can't be read on hover; B-15 Roster map: the hovered player is drawn under other text; B-27 Page headings get cut off or run under the inspector; B-28 Narrow windows and the inspector squeeze pages into uselessness; B-29 Detail cards are empty, repeat their label, or sit under the wrong row; B-43 Charts look broken or unexplained; B-44 Compare and History tables push content off-screen; B-46 The Morning Report puts "To decide" last on ordinary windows; B-55 Small layout slips; B-56 No automated check captures the Front Office report or a narrow Morning Report

### Batch 23 · Retire the old web routes and leftovers
- What: First move the AI staff's lookups onto services, then retire the unused and web-only addresses, the static export, old config and experiment scripts, and dead code.
- Size L · depends on: batch 7, batch 16 · owner decision first: Which React-only routes and the Electron app go now and which at cutover.
- Items: B-100 The AI staff's lookups go through the old web addresses; B-103 Old web-only addresses and the website export to retire; B-104 Leftover code, scripts and settings

### Batch 24 · Modernise libraries, Node and the tests
- What: Declare Node 24, fix the advisories, plan Express 5, type-check the tests and make the vacuous ones check something.
- Size M · depends on: batch 23 · owner decision first: Declare Node 24 now, and when to move to Express 5 and the other major upgrades.
- Items: B-99 Tests that check nothing, or never run; B-102 Libraries, Node and the web framework are out of date

### Batch 25 · Words, after the phrasebook
- What: Move every remaining wording item into phrasebook content.
- Size M · depends on: batch 13 · owner decision first: no
- Items: B-10 Walls of "on the 0–100 scale"; B-30 Department names and method terms speak on screen; B-31 The same caveat is repeated row after row; B-51 Titles, labels and column heads are inconsistent; B-52 "the Club 1 N" and "him" for everyone; B-53 Some words and numbers are written in the app instead of served; B-106 Some labels overstate or misplace what is known

## Owner decisions (pending)

Each is one question with a recommendation. The batch that waits on it is in brackets.

1. Should the price of a win depend on today's freshness (SRVVALUE-02)? Recommend no: measure it and the cost ladder from salaries set at the last winter, and show freshness beside it. [8]
2. Retire `posture.ts` from MLB's decision path (urgency, act bar, needs order) and from Player Value's price of a win (SRVMLB-03, -13)? Recommend yes; if odds stay at all, only in Standings, rebuilt on regular-season reads. [6]
3. Does D-060 also bar odds and buy/sell posture from AI tool answers (SRVAI-02)? Recommend yes: amend D-060 to cover every AI surface, and retire `get_dashboard`. [6]
4. Which React-only routes and the Electron app go now, and which at cutover (SRVHEALTH-08 to -10)? Recommend: first move the AI staff's lookups onto services; then retire now `exporter.ts`, `farmRoutes.ts`, `playerValueRoutes.ts` and the ten addresses no client calls; retire Electron, the token-less mode and the web-only routes at cutover, and until then bump Electron to 41.10.7, fix the Dock double start and require a token. [7, 23]
5. Glove weights under the detector, or an exemption (SRVMLB-10)? Recommend under the detector, like aging; no exemption. [4]
6. Fixed coverage floors or per-save ones (SRVMLB-08)? Recommend deriving the floors from the league's own active-roster limit now (a rule, not a fit), indeterminate when that is unknown, and measuring per save later with the farm timings (SRVFARM-24). [4]
7. Re-key notes, the watchlist, philosophy, budgets, themes and AI files by save id, with a one-time migration (SRVSTATS-10, SRVINFRA-08, -09)? Recommend yes, assigning existing data to the save configured at migration time. [1]
8. Move the save identity off the save name and player fingerprint (SRVINFRA-12)? Recommend yes, keyed on a stable save id, with a migration that carries the stored fits and market records across rather than orphaning them. [1]
9. After a save switch, discard unsaved notes or hold them for that save (MACKIT-03)? Recommend hold per save and offer them back on return. [2]
10. What does "Show no player ratings" show (SRVDEV-01)? Recommend every grade withheld and read as unknown, never a 50. [4]
11. May draft prospects OOTP hasn't revealed be searched or opened (SRVSTATS-11)? Recommend no. [4]
12. Stamp the rating scale on each snapshot, a stored-data format change (SRVDEV-04)? Recommend yes going forward; older snapshots read as scale unknown, not guessed. [4]
13. How a 0.00 ERA's ERA+ reads and sorts (SRVSTATS-05)? Recommend a plain "No earned runs" with the number in the hover, sorted ahead of every finite value. [9]
14. When some salaries are missing, should payroll room read "At most $X free" with a caution tone (SRVPRES-07)? Recommend yes. [5]
15. Floor a free agent's market figure at the league minimum, or re-word it as production value (SRVVALUE-05)? Recommend floor it and say so in the hover. [12]
16. What budget do the seasons after next use (SRVPRES-15)? Recommend next season's expected budget for next season only and "not set" beyond it, unless the GM sets one. [12]
17. How long should the app wait for an AI answer, and should the server cancel abandoned work (MACKIT-01, SRVAI-03)? Recommend streaming with heartbeats, a five-minute ceiling, and cancelling the server work when the app gives up. [16]
18. Default Claude model, Opus or Sonnet (SRVINFRA-27)? Recommend Sonnet as the default with Opus a choice, since every AI feature pays for it. [16]
19. Skip auto-writing when the game date hasn't changed (SRVAI-22)? Recommend yes. [16]
20. Offer the newest Claude models before the edited-history check is done, and refresh the fallback model lists (SRVAI-12)? Recommend refreshing the lists now and offering a new model only after a recorded check passes. [16]
21. Should a settings file that won't parse block writes until the GM confirms (SRVINFRA-03)? Recommend keep a backup, refuse to overwrite, and say so in Data Status. [3]
22. Declare Node 24 (what the Mac app ships) and when to move to Express 5 (SRVINFRA-10, SRVHEALTH-13)? Recommend declare Node 24 now; Express 5 and the other major upgrades after cutover, with the async-handler guard from batch 7 in the meantime. [24]
23. Should Clear Deal be undoable, and should the inspector get an Unpin control (MACUI-17, MACUI-06)? Recommend yes to both. [19]
