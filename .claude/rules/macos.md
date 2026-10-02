---
paths:
  - "docs/SWIFTUI_REBUILD.md"
  - "server/sidecar.ts"
  - "server/apiToken.ts"
  - "server/dataLock.ts"
  - "server/serverEvents.ts"
  - "scripts/build-sidecar.mjs"
  - "scripts/fetch-node-runtime.mjs"
  - "scripts/synthetic-league.ts"
  - "scripts/contract-build.ts"
  - "scripts/lib/contractSpec.ts"
  - "macos/**"
  - "contract/**"
  - "server/contract/**"
  - "server/presentation/**"
  - "server/themePackStore.ts"
  - "docs/theme-packs/**"
  - "docs/design/**"
  - "tests/bannedJargon.ts"
  - "tests/contract.test.ts"
  - "tests/apiRoutes.ts"
  - "tests/contractShapes/**"
  - "tests/sortCases.test.ts"
  - "tests/stringCatalog.test.ts"
  - "tests/swiftDesignRules.test.ts"
---

# Pennant for Mac (the SwiftUI rebuild): working reminder

This is a router, not the doctrine. The canonical detail is in `docs/SWIFTUI_REBUILD.md` and `docs/DECISIONS.md`
D-055 to D-062 (with D-001, D-008, D-018, D-020, D-041, D-049 and D-052's amendment of 2026-09-25). Where this file
and those documents differ, they win. The presentation cases are in `docs/BEHAVIOR_CASES.md` "Pennant for Mac".

- **The server decides and writes; Swift renders.** Swift code holds no baseball threshold, computes no ranking,
  place or verdict, and writes no copy beyond structural labels (menu, tab and column names in the String Catalog).
  A number shown is a number served. If a view needs a sentence or a judgment, add it to the server's payload.
- **Every visible sentence is a server `Claim`, `Row` or `Cell`** under `/api/v2/`, with its basis. Keep the
  plain-language rule (AGENTS.md "Writing for the GM") in the TypeScript that authors it; the banned-jargon list is
  one file, `tests/bannedJargon.ts`, and a script checks the String Catalog against it.
- **The contract is generated.** Change TypeScript types, run `npm run contract:build`, commit `contract/openapi.json`.
  Never hand-write a Swift model of a server type. Closed unions are open enums; game dates are unpadded strings,
  never parsed as dates in Swift.
- **Unknown stays unknown** in Swift too: a null sort key sorts last both ways, a missing value shows the served
  sentence, never zero, a dash read as zero, or an empty chart that looks like "none".
- **Server changes are additive while the React app lives.** New tables and files only; old routes keep working;
  the data folder is shared with the Electron app (D-049 hold) and protected by `server.lock`.
- **Glass on the controls layer only**; content opaque; colour never the only signal; every depth layer keyboard- and
  VoiceOver-reachable. macOS 26 minimum: a macOS 27 API only behind `#available` with a macOS 26 path.
- **Never commit** save data, fixtures from a private save (fixtures come from `tests/syntheticSave.ts`), signing
  material, provisioning profiles, team secrets or `xcuserdata`.
- New Swift or npm dependencies need the owner's approval (SWIFTUI_REBUILD.md section 9 lists the approved set).
- **The sidecar (N1)** is the same server started by the app: token and keys on stdin, never in the environment;
  `PENNANT_READY` / `PENNANT_FAILED` on stdout; a clean stop on SIGTERM or stdin closing; the data-folder lock
  (`server.lock`) on every server start. SWIFTUI_REBUILD.md section 5.1 "As built" has the protocol and exit codes.
- **Widen `paths:` as the rebuild lands.** Add `server/presentation/**` in the milestone that creates its first tracked
  file (N4); `tests/agentInstructions.test.ts` rejects a path that matches nothing yet.
- **The contract pipeline (N2):** `npm run contract:build` writes `contract/openapi.json`; `tests/contract.test.ts` fails
  on drift, on a `/v2` route missing from `server/contract/routes.ts`, and on a live response outside its schema.
  PennantAPI reads the spec through a link, never a copy; `swift build && swift test` in `macos/Packages/PennantAPI`.
  Ids and counts are `Integer`; export a concrete alias of a generic, never the generic; read events through
  `ServerEventReading` (a known type that did not decode is `malformed`, never ignored).
- **The app skeleton (N3):** `ServerController`, `AppModel`, the event client, routes, the comparator and backups live in
  PennantKit; the server reaches the bundle through `npm run mac:stage` and the "Embed the server" build phase (the
  repository's `node_modules` is never rebuilt for it). Run a Debug build or a test only on a scratch data folder
  (`PENNANT_DEV_DATA_DIR`, `npm run synthetic:league`), never the real one or `data/`; a Debug build given no folder
  starts no server. Every launch is gated on the first-run backup inside `ServerController`. The current club is
  served (`organization` on `/api/settings`); Swift never resolves it. The departments and their views live in
  PennantFeatures (one target per department, each a `DepartmentModule`); the app target assembles the registry, and a
  new view is a new `DepartmentViewDescriptor`. Every structural label goes in the app's String Catalog
  (`macos/Pennant/Localizable.xcstrings`; `tests/stringCatalog.test.ts` checks the Swift sources against it). Snapshots
  of the shell land in `build/macos-snapshots/`. SWIFTUI_REBUILD.md sections 3.1, 3.2, 3.6, 5.2, 5.3, 6 and 7.5, "As
  built at N3", have the details.
- **Quit only through `QuitCoordinator.requestQuit()`**, never `NSApp.terminate` from a `Task` or main-queue block (the
  `.terminateLater` wait cannot drain the main queue); `applicationShouldTerminate` answers through `shouldTerminate`.
- **Theme packs (N5, D-062):** every coloured piece reads the `Theme` in the environment (PennantDesign), resolved from
  the pack the catalog serves for the club (`theme`); never a colour of Swift's own. A club's default pack is its save's
  colours; installed packs are checked on the server (every text pair at 4.5:1, 7:1 with Increase Contrast) and refused
  whole. The masthead is content colour under the toolbar (`MastheadScrollView`), not glass; one floating control group
  at most per view (`FloatingControlGroup`). SWIFTUI_REBUILD.md section 3.7, "As built at N5 (Stage A)".
- **The design language (N5, Stage B):** R2 with the V2 roster diagram, built as PennantDesign components (typography,
  data graphics, motif, depth, the ⌘K palette) and applied to the Morning Report and the reports. Every card and chip
  is washed in the served accent (`Theme.Palette.wash`); glass only on controls (the palette, the Tonight card); a slot
  the server does not serve yet shows nothing in the app and is drawn from `DesignFixtures` in previews and snapshots
  only. A claim is a `ClaimText` (hover, click or Space, `BasisPopover`, pin to the inspector, detach). SWIFTUI_REBUILD.md
  section 3.7, "Design language (N5, Stage B)"; section 3.4, "What the design's slots need from the server".
- **The Morning Report, live and instant (N6, Stage B1):** the served payload reaches the design's models only through
  `MorningReportDesign(served:)` (one adapter file, pure, tested against the committed fixture); the last payload
  received is kept in the app's own caches (`KeptReports`, keyed by the id of the save the imported data came from, the
  club and `contractDigest`, and kept only when current for that key; never the data folder; tests give a scratch
  folder) and drawn at launch as "Updating" until the fresh one lands. `/api/status` locates no save: what it serves
  about the served save is worked out off the request path (`lookAtTheServedSave`). Read a server
  event through `ServerEvent.kind`, never `value1` … `valueN`. SWIFTUI_REBUILD.md section 3.4, "As built at N6 (Stage
  B1)".
- **Finding the save (N6, Stage B2):** a first run asks the server to set up by itself (`POST /api/v2/setup/automatic`)
  and asks the GM nothing when a save clearly stands out; every choice sends `club: "fromSave"`; "played since" and
  the rating-history questions are notices with the served actions (`NoticeStack`, dismissals per save in
  `NoticeMemory`), never acted on without a click; a Debug build sets up by itself only on a pretend home
  (`PENNANT_DEV_HOME`). Secondary text on the content is `.readableSecondary`, never the system's `.secondary`
  (the audit). SWIFTUI_REBUILD.md section 3.4, "As built at N6 (Stage B2)".
- Verify with `macos/scripts/test.sh` plus the server baseline; visual checks come from XCUITest and
  snapshot PNGs (`build/macos-snapshots/`), not from asking the owner to look.
- **A department's views (N10, Farm & Development):** one served payload per view under `/api/v2/views/:org/<dept>/…`,
  built with the club's Front Office on its key (in its worker) and kept; a native `Table` sorts by served keys through
  `ServedColumnSort` (unknown last, served order until a header is clicked) and a column with no served key gets no
  `sortUsing` (the stakes, D-050); a view that opens on one thing reads `\.routeSubject` (`AppRoute.subject`, a served
  target's `key`). SWIFTUI_REBUILD.md section 3.5, "As built at N10"; D-065.
