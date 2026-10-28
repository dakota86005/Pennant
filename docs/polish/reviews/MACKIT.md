MACKIT deep hunt report: the Mac app's non-view code (PennantKit, PennantAPI, and the app target macos/Pennant*)

Code read at origin/feature/swiftui e6cdd08, the current head; the brief named b49bc47. Worktree: scratchpad/deep/wt-mackit2. Nothing was committed or pushed, no app was launched and the Keychain was not touched. Only PennantKit was built and tested.

## Limits on this hunt
- **Real save not used.** Copying `scratchpad/realsave/data` into my own folder was refused by the permission classifier ("PII Data Handling"). I did not work around it, so no payload from the real save was decoded in Swift.
- **No live 60-second proof.** The sandbox blocks loopback connections: even `curl` to my own local test server timed out after about 7.8 s. So MACKIT-01 is traced, not proven by a run. The test for it is ready to run outside the sandbox.

## Proving tests left in the worktree
- `macos/Packages/PennantKit/Tests/PennantKitTests/DeepHuntMackitTests.swift`
  - Run with `swift test --filter DeepHuntMackitTests`.
  - These fail on e6cdd08: `staffNoteUndoRedo`, `noteDraftCrossesSaveSwitch`, `reloadAllOrdering`, `undoManagerFreed`.
  - `longAnswer` is skipped unless `MACKIT_SLOW_PORT` is set.
- `macos/Packages/PennantKit/Tests/PennantKitTests/DeepHuntMackitFixtureTests.swift`
  - Decodes all 153 `contract/fixtures/responses/*.json` as the Swift type the contract names for each. It **passes**: no contract drift on the synthetic save.
  - About 33 of those fixtures are decoded by no other Swift test. Worth keeping this test.
- `scratchpad/deep/mackit-slow/slow_server.py <port> [holdSeconds]` is the slow server for `longAnswer`.

## Findings, most severe first

**MACKIT-01 · H · CONFIRMED (traced; live proof blocked by the sandbox) · The AI desk and Staff room fail with "Couldn't reach the Pennant server" on any answer that takes more than a minute**
- **Evidence:**
  - Every request uses one URLSession with `timeoutIntervalForRequest = 60`, which is the longest allowed silence between bytes (`PennantClient.swift:35-44`).
  - The AI desk:
    - `TradesStore.ask` (`TradesStore.swift:245`) posts to `/v2/views/:org/trades/ask`.
    - The server runs a non-streaming tool loop and only answers at the end with `res.json(...)` (`server/ai.ts:502-505`, `askTheDesk` `:310`). Several Opus tool rounds often take more than 60 s.
  - The Staff room:
    - The answer stream (`server/chat.ts:1238`) has no keep-alive.
    - `runToolLoop` passes on only `text` and `tool` events (`chat.ts:825-856`), while adaptive thinking is on (`chat.ts:944-946`). Long thinking, or a local model loading cold, is silent for more than 60 s.
    - The app then sees `.unreachable`. The server sees the connection close, aborts the model and keeps only a partial answer.
  - Also caught: a Front Office request made during the one-time league upgrade (`frontOfficeService.ts:300-305`, "minutes") hangs with no bytes, then fails at 60 s.
  - Unproven aggravation: the per-host limit of 6 connections, with the event stream holding one forever.
- **Trigger:** ask the AI desk about a multi-player deal with Opus, or ask the Staff room a hard question. Either way the GM pays for tokens and the app throws the answer away.
- **Fix:** set long per-operation timeouts (or a second session) for the AI and SSE calls, and send `: keep-alive` on the ask stream and while the AI desk thinks. Related to B-49.

**MACKIT-03 · H · PROVEN (`noteDraftCrossesSaveSwitch`) · A note typed in one save is written onto the player with the same id in another save**
- **Evidence:**
  - `PlayerStore` keeps `drafts`, `notes`, `keptTyped` and `followedByNote` by player id only (`PlayerStore.swift:20-37`).
  - `flush` (`:182-203`) and `lastSaves` (`:207-219`) send whatever draft is pending to whichever save the server serves now.
  - The server writes to the current save by id (`server/playerViewService.ts:259-266`), and writing a note also follows the player.
  - A failed save keeps the draft on purpose. The server refuses note saves with "isn't imported yet" (`:264`, `snapshotsAllowed`). It plausibly returns that during a switch, before the new import lands; I did not verify this.
  - So the draft goes to the new save on the next window close, section switch or quit. An emptied draft plus `followedByNote` would unfollow the other save's player.
- **Trigger:**
  1. Type a note in a player window.
  2. Switch saves ("played since", or Choose Another Save).
  3. Close the window or quit.
- **Fix:** scope drafts to the `StoreKey` scope (save and club), and drop or hold them when `follow()` sees another save. Extends B-07.

**MACKIT-02 · M · CONFIRMED (traced) · After choosing a save whose import fails, the old save's Morning Report and club card stay up as "Updating" for the rest of the session**
- **Evidence:**
  - Choosing a save makes the status stop naming the old save at once (`server/api.ts:829-830`). `saveId` stays nil until the new import lands.
  - `FrontOfficeStore.awaitsTheChosenSave` (`FrontOfficeStore.swift:113-116, 190-193`) then refuses every load while `importStamp` is unchanged. A failed import keeps the old `lastImport` (`AppModel.swift:755`).
  - `heldCatalog` keeps the old club card.
  - After a relaunch the same old-save report is fetched and shown as current.
- **Trigger:** choose a save whose export is missing or corrupt.
- **Fix:** stop holding when the import finishes with an error (`importNote` or `lastError`), and show the served problem instead.

**MACKIT-04 · M · PROVEN (`staffNoteUndoRedo`) · Undo of "Remove Staff Note" leaves no Redo; pressing ⌘Z again removes the note again**
- **Evidence:** `PlayerStore.swift:441-453` registers the redo inside `Task { … await restoreStaffNote … }`, after the undo has finished. It lands on the undo stack, unnamed, and clears the redo stack. The desk, Following and philosophy undos register the inverse synchronously; this one does not.
- **Fix:** register the inverse synchronously while undoing (as `registerStep` does), and drop it if the request fails.

**MACKIT-09 · M · PROVEN (`undoManagerFreed`, with a control that is freed) · Every closed window's undo manager leaks, and `undoSteps` grows all session**
- **Evidence:** each handler captures its own `undoManager` strongly (`Attention.swift:74`, `PlayerStore.swift:441/448`, `PhilosophyStore.swift:270`). That makes a manager → stack → closure → manager cycle. `undoSteps.removeAll { $0.manager == nil }` therefore never prunes anything.
- **Trigger:** any desk, follow, note or philosophy change made in a window that is later closed.
- **Fix:** capture `[weak undoManager]` in the handlers.

**MACKIT-05 · M · PROVEN as a mechanism (`reloadAllOrdering`) · An older `reloadAll` that finishes last puts the old club back**
- **Evidence:** `AppModel.reloadAll` (`AppModel.swift:859-927`) has no generation guard. It is fired from unstructured Tasks (`:705`, `:841`) and from `saveSettings`, `chooseTheme` and Setup's `onClubSaved`.
- **Trigger:** the first-run club pick, or a theme or club change, overlapping a post-import reload with slow answers. Rare in practice.
- **Fix:** number each reload and apply only the newest.

**MACKIT-06 · L · SUSPECTED · Events missed while the event stream reconnects are never recovered for the desk or AI writing**
- **Evidence:** `hello` restores only `ServerStatus`, which carries no desk or follow stamp and no job state (contract `ServerStatus`; `AppModel.swift:738`). A missed `desk-changed` or `job` (finished) leaves a stale desk, or a briefing stuck on "writing", since there is no polling.
- **Trigger:** the stream drops while the server is up (sleep and wake, or the server's main thread busy longer than 60 s).
- **Fix:** on reconnect, re-read the desk and any piece still "writing".

**MACKIT-07 · L · SUSPECTED · A key saved in Settings in the first seconds of launch can be lost**
- **Evidence, two paths:**
  - `ServerController.updateKeys` finds `process == nil` while `launch()` is between reading the keys and spawning (`ServerController.swift:266-267, 329-336`). It returns `.handedOver` and the server starts with the old keys.
  - The sidecar attaches `lines.on('line')` only after two `await import(...)`s (`server/sidecar.ts:84-113`). A keys line sent in that gap is dropped by readline.
- **Fix:** re-send the keys after READY when they changed during the launch, and attach the line handler before the awaits.

**MACKIT-08 · L · CONFIRMED · Quitting while the server is down or restarting drops unsent note drafts silently**
- **Evidence:** `lastSaves` returns `{}` when `client` is nil (`PlayerStore.swift:209`).
- **Fix:** keep the drafts on disk, or warn before quitting.

**MACKIT-10 · L · CONFIRMED · Saving an empty or whitespace key reports success**
- **Evidence:** `saveKey` returns `.handedOver` when the trimmed key is empty (`AppModel.swift:954-955`).
- **Fix:** throw, so Settings shows that nothing was saved.

**MACKIT-11 · L · SUSPECTED · Saving a key deletes the old one before adding the new one**
- **Evidence:** `KeychainItems.save` deletes this copy's items before `SecItemAdd` (`KeychainItems.swift:164-183`). If the add fails, the old working key is gone.
- **Fix:** add under a free name first, then delete the old items.

**MACKIT-12 · L · CONFIRMED (defence in depth) · `servedFile` would send the token to another host if ever given an absolute URL**
- **Evidence:** `PennantClient.data(path:)` resolves the path with `URL(string: path, relativeTo:)` (`PennantClient.swift:24-31`), so an absolute URL in a served path would carry the bearer token off the machine. Today's paths are all `/api/...`.
- **Fix:** refuse anything that is not a relative `/api/` path.

**MACKIT-13 · L · CONFIRMED · Player Search can mix rows from two imports**
- **Evidence:** a `loadMore` page answered while the first page is re-read for a new key is appended to the wrong first page (`ScoutingStore.swift:226-252`).
- **Fix:** key pages to the first page's `reportStamp`.

**MACKIT-14 · L · CONFIRMED · Smaller items**
- `FollowedKey.earlier` grows without bound with every build stamp (`FollowedKey.swift:45-47`).
- The widget's `ForEach(snapshot.missing, id: \.self)` collides on duplicate sentences (`PennantWidgets/GlanceWidgetView.swift`).

## Checked and found sound
- The sidecar token and keys travel on stdin only, and the child gets a minimal environment.
- `ExitState` cancellation and the QuitCoordinator's run-loop reply.
- The Keychain dialog switch is serialised.
- KeptReports writes are atomic and keyed by save, club and contract.
- The App Group container is entitlement-gated.
- Spotlight entity ids are scoped by save.
- The Sparkle consent-first setup.
- Every captured fixture decodes in Swift.

## The three riskiest areas for a deeper look
1. **Long requests on the single 60-second URLSession.** The AI desk, Staff room, decisions and Front Office builds during an upgrade, and the 6-connection pool all share it. They need per-operation timeouts, server keep-alives and a slow-transport test.
2. **Save-switch scoping of every per-id cache and write path.** This covers notes and follows, staff-note undo, club, player and compare windows, `ServedImages`, `IntegrationStore` with a nil `saveId`, and a failed import after a switch. A "switch save mid-action" test matrix is missing.
3. **The undo machinery.** It has async registrations, strong captures and scope drops. Every `registerUndo` site needs an undo/redo/undo test and a test that the window's manager is freed when it closes.