# Pennant for Mac: the polish bug list (round 1)

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
- Status: open
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
- Status: open
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

## Proposed fix batches

Each batch fixes one root cause across every department, and is about one PR. Behaviour and data come first; wording waits for the phrasebook.

**Batch 1: Unknown stays unknown.** Stop turning missing stats, unread clubs and unknown lists into zeros or green verdicts; fix the bench read that counts a lone catcher as his own backup.
- B-02 Missing stats are shown as zero
- B-12 Pages say all is well when nothing has been read
- B-13 Counts show zero when the list isn't known, and unpriced contracts drop out of totals
- B-17 The only catcher is counted as his own backup

**Batch 2: No developer or code text on screen.** Give calibration stamps a GM-facing line separate from their provenance; never interpolate level ids, column names or enum values into served text.
- B-01 Hover notes show developer details and a developer's local save
- B-11 Code words reach the screen ("level 2", column names)

**Batch 3: One number and count formatter.** A single shared helper for counts, plurals, thousands, minus signs, dashes and innings (x.1/x.2), replacing the ~18 local copies.
- B-06 Counts and plurals read wrong ("Started 1 games", "2076")
- B-09 Innings are written as decimals (10.7 instead of 10.2)

**Batch 4: Stores follow the save and never strand a view.** Every store resets on a save or club switch; the in-flight guard survives cancellation; errors clear on a good answer; page state survives navigation; inputs say why they were refused.
- B-07 Another save's farm, players and notes stay on screen after a switch
- B-08 Pages can get stuck on Loading or keep an old error
- B-36 Pages forget or ignore where you were
- B-48 The payroll budget box silently throws away what you type
- B-49 The GM's question disappears while the trade desk thinks

**Batch 5: Sidebar and Mac behaviours.** Clickable, keyboard-reachable sidebar headers without the per-click rebuild; farm rows publish the focused player; palette, menu bar, badges and drag and drop behave like a Mac app; trim per-render work.
- B-03 The sidebar doesn't respond like a Mac sidebar
- B-37 Farm rows and player windows lack the usual Mac controls
- B-38 Farm pages open on empty filters
- B-41 Sidebar badges, the menu bar and the widget
- B-42 Quick Open can open the wrong thing
- B-45 Heavy work on every redraw
- B-54 Drag and drop and "Open in New Window" fall short

**Batch 6: Settings, Setup and the transaction-log fix.** Data Status and every log-missing line point to the fix; a set AI key looks set; Settings exposes its choices and state; Setup counts clubs the way the club list does and explains exports.
- B-05 "Transaction history unavailable" never says how to fix it
- B-14 A saved AI key looks the same as no key
- B-39 Setup contradicts itself and doesn't guide
- B-40 Settings hides choices and state

**Batch 7: Decision pages.** Dedupe the comparison, name the player in farm findings, compose each reason once, condition sentences on what's actually present, and make the clubhouse pages agree on position and grade.
- B-16 The same player appears twice on a Decision
- B-18 Farm findings don't name the player
- B-23 Decision pages say the same thing two or three times
- B-24 Decision pages contradict themselves
- B-25 A Decision promises things that aren't there
- B-35 Clubhouse pages disagree on who plays where and how good he is

**Batch 8: Facts agree across pages.** One freshness and byline source; one payroll-room definition; one staff role vocabulary and a human-GM check; a current "later version" list; correct club links; trade validity; server-side draft sorting; the wire's injury.
- B-19 The Morning Report says four departments "come in a later version"
- B-20 A farm player's club link opens the big-league club
- B-21 The Trade Desk weighs trades that can't happen
- B-22 Draft Board sorting only sorts the first 300 players
- B-26 Pages disagree on today's date and how fresh the data is
- B-32 Payroll room and payroll differ between Finance pages
- B-33 Staff titles differ between pages, and the GM's report may be credited to someone else
- B-34 "Whose ratings" reads Not known, with no way forward
- B-47 The philosophy summary contradicts itself when nothing is set
- B-50 Wire injury lines name no injury

**Batch 9: Tables, heads and layout.** Per-column widths and full-text hovers in the shared tables; heads that wrap instead of truncating; roster-map z-order; empty-state cards; narrow and inspector layouts; charts; CI captures for the missing views.
- B-04 Table text is cut off and can't be read on hover
- B-15 Roster map: the hovered player is drawn under other text
- B-27 Page headings get cut off or run under the inspector
- B-28 Narrow windows and the inspector squeeze pages into uselessness
- B-29 Detail cards are empty, repeat their label, or sit under the wrong row
- B-43 Charts look broken or unexplained
- B-44 Compare and History tables push content off-screen
- B-46 The Morning Report puts "To decide" last on ordinary windows
- B-55 Small layout slips
- B-56 No automated check captures the Front Office report or a narrow Morning Report

**Batch 10: Words, after the phrasebook.** Percentiles instead of "on the 0–100 scale", no department names as speakers, one caveat instead of one per row, consistent titles, no "the" before club names, and copy moved out of Swift.
- B-10 Walls of "on the 0–100 scale"
- B-30 Department names and method terms speak on screen
- B-31 The same caveat is repeated row after row
- B-51 Titles, labels and column heads are inconsistent
- B-52 "the Club 1 N" and "him" for everyone
- B-53 Some words and numbers are written in the app instead of served
