## MACUI deep hunt: Mac app views (PennantFeatures and PennantDesign)

I worked read-only in `scratchpad/deep/wt-macui2`, at `origin/feature/swiftui` e6cdd08 (newer than the brief's b49bc47). The only things I added to the worktree are a `node_modules` symlink and the two proof files listed at the end. I did not run `swift test` and did not launch the app. I avoided re-reporting B-01 to B-56, and marked extensions where one applies.

Path shorthand: `PF/` = `macos/Packages/PennantFeatures/Sources/`, `PD/` = `macos/Packages/PennantDesign/Sources/PennantDesign/`.

### Findings, most severe first

**MACUI-01 · H · CONFIRMED · VoiceOver never hears a figure's number, or a roster plate's Need, value and place**
- **Evidence:**
  - `PD/Depth.swift:62-73`: `ClaimText` puts `.accessibilityLabel(Text(verbatim: claim.text))` on its Button, which replaces everything drawn in its label.
  - Every figure has its number in `claim.value` and only its label in `claim.text`. From the saved payloads: "Payroll this season" with "$84.1M", "Run differential" with "−16", "4 of 8 departments reporting" with "4 of 8".
- **Affected:**
  - figures: `ReportFigures` (`PF/FeatureCore/FrontOfficeViews.swift:369-371`), `OfficeFigures` (`OfficeKit.swift:230-235`), `ClaimValue` (`Depth.swift:104-113`), the runs figure (`MorningReportView.swift:261-265`) and `FarmHead` (`FarmCommon.swift:376-385`);
  - the roster map's plates (`PD/RosterDiagram.swift:247-298`). The claim says "P 1012 at catcher" while the plate also draws Need, "0.1 wins", "3rd of 3", Listed and the control pips. The custom content carries only overlap, behind and farm. So the Need flag and the value reach VoiceOver users nowhere.
- **Trigger:** VoiceOver on any masthead, office figures or the roster map.
- **Fix:** have `ClaimText` add `.accessibilityValue(claim.value?.display)` and accept a spoken label from callers. Put Need, value and place into the plate's label or value.

**MACUI-02 · M · CONFIRMED · Commands act on rows the filter or search has hidden**
- **Evidence:**
  - `OfficeTablePane.chosenRow` already guards with `only` (`OfficeKit.swift:766-768`).
  - These do not guard:
    - `chosenPlayers` (`:618`), which drives Player ▸ Open Player and Compare ⌥⌘C (`:584-585`);
    - the context menu (`:586-588`);
    - `primaryAction` (Return or double-click: `table.rows.first(where: ids.contains)`, `:590-599`).
  - The selection keeps ids that are no longer shown. The first match is taken in served order, not the visible sorted order.
  - The farm repeats the pattern with `view.rows` instead of the filtered rows: `FarmProspectsView.swift:76,80`, `FarmDevelopmentView.swift:93,97`, `FarmAssignmentsView.swift:100,104`.
- **Trigger:** Free Agents, Contracts, Player Search or the farm. Choose rows, then filter or type so they are hidden. Return, ⌥⌘C or the menu then opens or compares the hidden player.
- **Caveat:** this assumes SwiftUI's `Table` does not prune its selection binding. The `chosenRow` guard shows the authors expected that.
- **Fix:** intersect the selection with the visible ids everywhere, and take "first" in the visible order.

**MACUI-03 · M · CONFIRMED · A failed choice strands an open Decision**
- **Evidence:**
  - `PF/MajorLeague/DecisionView.swift:106-122` uses `ViewState`, which shows only the problem when `decisionProblems[query]` is set (`Components.swift:204-217`). That hides `lastShown` and all its choices.
  - `query` is view `@State`. `loadDecision` (`PennantKit MajorLeagueStore.swift:176-192`) re-runs only when the key or query changes. Back (⌘[) does not undo a choice.
- **Trigger:** pick a duration, assignment or role whose read fails or times out. The page becomes a bare problem line until the GM leaves and comes back.
- **Fix:** draw the problem above `lastShown` with the choices kept, and add Try Again.
- Related to B-08 but a different path.

**MACUI-04 · M · PROVEN · The trade builder suggests "All N in Player Search" as a player**
- **Evidence:**
  - `PF/Trades/TradeBuilderView.swift:214` keeps every result of the group whose kind is player.
  - The server pushes a view result (`id: 'scouting.playerSearch'`) into that group (`server/presentation/searchWords.ts:96-97`).
  - Choosing it: `Int(chosen.id)` is nil, so nothing is added. The field is left showing "Open in Player Search · Scouting #scouting.playerSearch". The `.task` guard then stops searching.
  - It appears whenever fewer than 12 players match, so any surname search.
- **Proof:** `npx vitest run tests/macuiProofs/searchPlayerGroup.test.ts` fails, and the non-player result it finds is `["view","scouting.playerSearch","Open in Player Search"]`.
- **Fix:** filter to `result.kind == .player`.

**MACUI-05 · M · CONFIRMED · Player menu stays disabled with a row chosen in most tables (extends B-37)**
- **Evidence:** only `OfficeTable` publishes `.focusedValue(\.player)` and `\.chosenPlayers` (`OfficeKit.swift:584-585`; full grep result). Tables that publish nothing:
  - Major League Ops' `ServedTable` (`MajorLeague/ServedTable.swift:123-166`): Rosters, 40-Man, Lineup, Pitching, Candidates, Schedule;
  - Philosophy's staff table (`PhilosophyCommon.swift` ~151);
  - the player's History table (`PlayerHistoryTab.swift:107-131`);
  - the farm tables.
- **Effect:** Open Player ⌥⌘O, Compare ⌥⌘C and Ask Staff About Him are disabled with a row chosen.
- **Fix:** the same two `focusedValue`s on every table.

**MACUI-06 · M · CONFIRMED · Pinned evidence and the toolbar search answer survive a save or club switch (extends B-07)**
- **Evidence:**
  - `MainWindowModel.pinnedClaim`, `searchAnswer` and `searchProblem` (`PF/Shell/MainWindowModel.swift:26-28,69,131-134`) are never cleared. There is no unpin anywhere (grep: only set at `:132`, read at `MainWindowView.swift:513`).
  - `.task(id: window.searchText)` (`MainWindowView.swift:107-124`) does not re-run on a switch, so the old answer stays "current". Return (`:102-106`) then opens the old save's first result, a player id from another save.
- **Fix:** clear these on a `storeKey` change, and add Unpin to the inspector.
- Related: detached basis windows (`WindowGroup` of a Codable `Claim`) also restore stale evidence.

**MACUI-07 · M · SUSPECTED · Player Search can lose its scope when replaced by another Player Search route**
- **Evidence:** `PF/Scouting/ScoutingViews.swift:249-255` uses `.onAppear { scope = … }`, `.onDisappear { unscope() }` and `onChange(currentRoute.key) { text = key }`. `.id(window.route)` (`MainWindowView.swift:410`) swaps the identity.
- **Risk:** if the old view's `onDisappear` runs after the new view's `onAppear`, `unscope()` wipes the new scope and text. That ordering is common in SwiftUI identity swaps.
- **Trigger:** two palette "in Player Search" opens with different words, or Back/Forward between them.
- **Fix:** give the scope an owner token, and unscope only when it still owns it.

**MACUI-08 · M · CONFIRMED · Stateful views inside `ViewThatFits` lose their state when the layout reflows**
- **Evidence:** `BuilderSection` builds two separate `TradeSideView` instances, one per branch (`TradeDeskView.swift:~118-136`). Each has its own `AddPlayerField` `@State` (typed name, suggestions) and drop-target state. Crossing the width breakpoint (window resize, inspector toggle) swaps to the other instance, with empty state.
- Same pattern: `OfficeRowDetail` and `RowDetail` blocks (`OfficeKit.swift:699-707`, `ServedTable.swift:277-286`) keep their disclosure state per branch.
- **Fix:** one instance laid out by a custom `Layout`, or hoist the state.

**MACUI-09 · L · PROVEN · `case .good, .bad, .caution where chip:` applies the `where` to `.caution` only**
- **Evidence:** `OfficeKit.swift:36`, `MajorLeague/Components.swift:33`. With `chip: false`, good and bad cells still draw as a Pill.
- **Proof:** `swift scratch-proofs/macui/where_clause.swift` prints `good chip:false -> Pill`. Latent: no caller passes `chip: false` yet.
- **Fix:** `case .good where chip, .bad where chip, .caution where chip:`.

**MACUI-10 · L · CONFIRMED · Disclosure state set once from init leaks between contents (extends B-36)**
- **Evidence:** `OfficeBlock` (`OfficeKit.swift:110-115`), `BlockView` (`Components.swift:107-114`) and `Fold` (`FarmCommon.swift:549-556`) take `@State expanded` from `collapsed` at init. They are drawn under `ForEach(id: \.offset)` in a row detail that has no `.id(row.id)` (`OfficeKit.swift:801-802`, `ServedTable.swift:252-253`).
- **Effect:** choosing another row keeps the previous row's open or closed state per position.
- **Status:** latent for row details, since no saved payload serves a collapsed row block. Decision blocks are served collapsed (`server/presentation/majorLeague/decision.ts:120,208,248`).
- **Fix:** `.id(row.id)` on the detail, or key the state by block id.

**MACUI-11 · L · SUSPECTED · Dragging a philosophy slider can send its change twice**
- **Evidence:** `PF/Philosophy/OrganizationalPhilosophyView.swift:287-308` and `PreferenceSlider` (`:361-368`).
  - The drag end calls `commit()`.
  - The value changes made during AppKit's tracking loop reach `onChange(value)` after `dragging` is already false, which starts the 350 ms settle task.
  - If the server's answer is slower than 350 ms, `commit()` sends again, adding a second undo entry.
- **Fix:** record the value last sent and skip equal sends, or cancel the settle task after a drag ends.

**MACUI-12 · L · CONFIRMED · SwiftUI menu Pickers remain where D-073's amendment calls for `PopUpChoice`**
- **Evidence:** the Wire's three toolbar filters (`League/WireView.swift:63-90`) and the Decision candidates' Group picker (`DecisionView.swift:479-492`).
- **Effect:** VoiceOver's "Action is missing", which the amendment recorded for this picker.
- **Gap:** no test enforces the rule (`tests/swiftDesignRules.test.ts` has none).

**MACUI-13 · L · CONFIRMED · The chosen affiliate is marked only by colour**
- **Evidence:** `PF/Farm/FarmAffiliatesView.swift:62-90`. Selection is hand-made: a fill only, with no `.isSelected` trait, so VoiceOver doesn't hear which club is chosen. `.focusable()` on a List adds a second focus stop.
- **Fix:** `List(selection:)`, or add the trait.

**MACUI-14 · L · CONFIRMED · Unknown cells turn faint on a chosen row in Major League Ops, farm and History tables**
- **Evidence:** `MajorLeague/Components.swift:35-36` and FeatureCore `CellText` (`ServedTable.swift:73-74`) always use `.readableSecondary`. `OfficeCell` switches to primary on `backgroundProminence == .increased` (`OfficeKit.swift:25,40`); these do not.

**MACUI-15 · L · CONFIRMED · "Ask Staff About Him" can be silently dropped**
- **Evidence:** `PF/Shell/StaffRoomScene.swift:165-176`. `router.take()` consumes the player before `askAbout` can refuse: AI off, an empty room, or an answer already streaming. No feedback is shown.

**MACUI-16 · L · CONFIRMED · Switching record in History keeps the old table's columns and sort (extends B-36)**
- **Evidence:** `PlayerRecordTable` (`PlayerHistoryTab.swift:98-106`) has no `.id(table.id)`. Its `@SceneStorage` key `player.table.<id>` is fixed at first init, so the batting table's column customization is applied to pitching, as well as its sort.

**MACUI-17 · L · CONFIRMED · Trade builder edits can't be undone**
- **Evidence:** `TradeDeskView.swift:61-70` and the remove and move buttons. Clear Deal wipes a built deal with no ⌘Z and no confirmation, unlike every other change in the app (desk, follow, philosophy, notes).

**MACUI-18 · L · CONFIRMED · Every Decision's candidate tables share one stored layout**
- **Evidence:** `DecisionView.swift:471`, id `"candidates.\(index)"`. Column customization (`SceneStorage`) and the divider height (`AppStorage`) are shared across every Decision's candidate tables.

**MACUI-19 · L · CONFIRMED · The trade chart's audio graph speaks a value the server didn't serve**
- **Evidence:** `TradeBuilderView.swift:369`. The VoiceOver audio graph's "most likely" is `(likelyLow + likelyHigh) / 2`, a midpoint computed on the Mac (cf. the review L3 rule in `CompareWindowView.swift:206`).
- **Fix:** use a served point, or present the likely values as a range.

**MACUI-20 · L · CONFIRMED · Per-delta cost while an answer streams**
- **Evidence:** `StaffConversationView.swift:88-97`. `previous(of:)` rebuilds `kept` twice per visible message on every streaming delta; `LiveAnswerView` builds `Set(kept.map(\.id))` too.
- **Effect:** about O(visible × n) array copies per delta in a long conversation.

**MACUI-21 · L · CONFIRMED · Desk actions for VoiceOver don't match the menus**
- **Evidence:** `FrontOfficeViews.swift:149-159`. VoiceOver is offered Mark Reviewed and Mark Handled even when the item already has that status (the menus disable them), and only the first defer day.

**MACUI-22 · L · CONFIRMED · Every claim and every name is a Tab stop and shows a focus ring on click**
- **Evidence:** `ClaimText` (`Depth.swift:64`) and the name modifiers (`Attention.swift:249,294`) add `.focusable()`.
- **Effect:** the Morning Report holds dozens of Tab stops, and clicking shows rings that Mail and Finder don't. Partly B-03 and B-37.

**MACUI-23 · L · CONFIRMED · Settings' club picker can hold a selection that has no row**
- **Evidence:** `SettingsView.swift:151-172`. When `humanClubs == 0` and the source isn't configured, the getter returns nil but no "Automatic" tag exists. The picker then holds an invalid selection: it shows blank or a wrong choice, and SwiftUI warns.

### The three riskiest areas
1. **`ClaimText` is the universal wrapper for every claim.** Its accessibility label, focus and Space-key behaviour reach every page. There is no VoiceOver label or value test: the audits check contrast and roles, not content. Add label and value assertions for figures and plates.
2. **Selection and focus are built five ways:** `OfficeTable`, `ServedTable`, the farm `Table`s, `PlayerRecordTable` and the staff tables. Each differs on hidden rows, focused players, primary action and order (MACUI-02, -05, -14). One shared table component would remove a class of bugs.
3. **State lifetime under `.id(window.route)` and save switches:** state living on the window model (MACUI-06), `@State` taken from init (MACUI-10, -16), `onAppear`/`onDisappear` ordering (MACUI-07) and `ViewThatFits` duplicates (MACUI-08). None of these paths is tested, because PennantFeatures' tests draw windows.

### Proof files in the worktree
- `scratchpad/deep/wt-macui2/scratch-proofs/macui/where_clause.swift` (MACUI-09). Run with `swift <file>`.
- `scratchpad/deep/wt-macui2/tests/macuiProofs/searchPlayerGroup.test.ts` (MACUI-04). Fails as expected with `npx vitest run tests/macuiProofs/searchPlayerGroup.test.ts`.
- `node_modules` in the worktree is a symlink to the main checkout's.