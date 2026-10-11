# Developing Pennant

How to run, test, build, version and release the project. For what the software *is* and the boundaries new work must
keep, read [ARCHITECTURE.md](ARCHITECTURE.md) and [DECISIONS.md](DECISIONS.md) first.

## Run it

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. This is the one development command. It starts two processes and prefixes their output:

| Process | Port | What it is |
|---|---|---|
| `web` | 5173 | Vite, the page you open. Proxies `/api` to the API. |
| `server` | 5178 | The Express API (`tsx watch`, so server edits reload). |

The ports are decided in one place, `scripts/devPorts.ts`, which both halves read:

- `PORT` moves the **page** (Vite). A tool that exports `PORT` to the dev process therefore moves the page and cannot
  put the API on the same port.
- `OOTP_FO_API_PORT` moves the **API**. It is never taken from `PORT`.
- If the two would be equal the API moves to the next port up.
- Vite runs with `strictPort`: a busy port is an error, not a silent move to some other port.

The API half is `scripts/dev-server.ts`, which pins `PORT` before loading `server/index.ts`. Production is different on
purpose: `npm start` runs one process, so it keeps honoring `PORT` (default 5178).

`npm run dev` does not import anything by itself. On first launch the app finds your OOTP saves, or you pick a folder;
see the README. In source mode all state lives in the git-ignored `data/` directory.

### One process, production-style

```bash
npm start        # builds the frontend, then serves it and the API from one port
```

`npm start` sets `NODE_ENV` with POSIX syntax, so on Windows use `npm run dev`, or set the variable in your shell first
and run `npm run build && npx tsx server/index.ts`.

### Preview tooling

`.claude/launch.json` has a single configuration, `pennant`, which runs `npm run dev`. It used to have a second
"one port" configuration that existed only because the API read the same `PORT` as the page; that is fixed and the
extra configuration is gone (see `tests/devPorts.test.ts`). Under a sandboxed preview the OOTP save folder may be
unreadable; that is logged and harmless, and the header shows *Roster data: Partial*.

## Validate

```bash
npx tsc --noEmit    # TypeScript
npm test            # Vitest, over a synthetic temporary league (never a real save)
npm run build       # Vite production build
```

The suites share one SQLite handle and run serially. Tests must use synthetic data. New baseball behavior gets a case in
the behavioral corpus first ([BEHAVIOR_CASES.md](BEHAVIOR_CASES.md)).

Player Value's cross-save suite runs every Player Value entry point over synthetic saves of many shapes (a brand-new
fictional league, 60- and 100-game schedules, a reserve clause, no financials, a broken parent chain, missing tables and
columns, two top-level leagues, and more) and asserts what must hold on any save: no exception, no non-finite number,
every unknown with its reason, no label claiming more calibration than the fit in force. It is part of `npm test`, about
ten seconds; run it alone with:

```bash
npx vitest run tests/playerValueCrossSave.test.ts
```

`tests/syntheticSave.ts` builds the saves: `buildSave(spec)` rewrites the per-file fixture league (a temporary directory,
never `data/`) to the shape a spec asks for, and `dropTable`, `dropColumn` and `exec` reshape it into an older or thinner
export. A new save type is one `it` with a spec. A gap another change owns is an `it.todo` naming its finding, turned into
a real case when the fix lands.

Charts use visx (D-054): keep a chart's layout in a pure geometry module and test it there, and render the component
with `react-dom/server`'s `renderToStaticMarkup` in a `.test.ts` (Vitest runs in Node, with no DOM);
`tests/productionCone.test.ts` is the pattern. Colours come only from `src/chartTheme.ts`.

Measurement scripts run against a real import and are not part of validation:

```bash
npm run check:stats         # derived-stat centering
npm run check:theme         # generated team-palette contrast (the CSS values and the Mac app's served tokens)
npm run calibrate           # scouting constants against league history (CALIBRATION.md)
npm run farm:base-rate      # how often Minor League Operations raises something
npm run farm:usage-window   # re-measures the provisional windowed-usage constants
```

Point them at a database with `OOTP_FO_DATA_DIR=<directory containing league.db>`; `check:theme` takes the database's
path instead (`npm run check:theme -- <league.db>`, `./data/league.db` by default), so it runs on a synthetic league
(`npm run synthetic:league -- <folder>`) as well as a real import.

Pull requests and pushes to `main` are validated by `.github/workflows/ci.yml` (typecheck, tests, build on Linux). It
holds no signing material and never packages anything.

### Dependency audit

Last run 2026-09-23: `npm audit` reports 0 vulnerabilities. Nothing is left unresolved. Of the ten reported
findings, nine were patch releases inside the existing ranges and needed only `npm audit fix`, without `--force`:
`vitest`/`@vitest/mocker`, a dev dependency; `qs` and `body-parser` through `express` 4, the localhost server;
`js-yaml`, through `electron-updater` (runtime) and `electron-builder`; `@xmldom/xmldom` and `fast-uri`, through
`electron-builder` (packaging only); and `nanoid` through `vite`/`postcss` (build only). The tenth, `csv-parse`, took a
major upgrade from 5 to 7. Its changelog renames no option the importer passes (`delimiter`, `relax_column_count`,
`relax_quotes`, `skip_empty_lines`). The advisory's `columns` path is not reachable because the importer reads rows as
arrays. A 5-against-7 comparison on edge-case input with those options gave identical output.

When auditing again, fix what `npm audit fix` fixes, and take a major upgrade only after reading its changelog against
this codebase and passing the validation baseline. Do not start an Express 5 migration just to satisfy the audit. Move
`better-sqlite3` or `electron` only if the audit requires it, because both carry native ABI concerns.

## Desktop app

```bash
npm run desktop        # rebuild native modules for Electron, build, launch
npm run desktop:build  # web build + the Electron main/preload/server bundle
npm run dist:mac       # package for macOS (run on a Mac)
npm run dist:win       # package for Windows
```

Electron uses a different native-module ABI from ordinary Node. The desktop scripts rebuild `better-sqlite3` for
Electron; before returning to `npm run dev`/`npm test`, run `npm run abi:node`.

**Known trap.** `abi:node` does not clear the marker `@electron/rebuild` leaves at
`node_modules/better-sqlite3/build/Release/.forge-meta`, so an `abi:electron` run after it can report "finished" without
rebuilding. The packaged app then loads a Node-ABI SQLite binary and sits on a startup error dialog. If a desktop build
will not start, delete that file and run `npm run abi:electron` again. CI is unaffected.

**Smoke-testing a build.** Run the binary with both `OOTP_FO_DATA_DIR=<scratch>` and `--user-data-dir=<short scratch
path>`: the first isolates the league data, the second Chromium's profile, and without it the app writes into
`~/Library/Application Support/ootp-front-office`.

Packaging is configured in `electron-builder.yml`. Artifacts are named `Pennant-<version>-<arch>.<ext>`; the name is a
literal, never built from `${name}`, so the compatibility-held package name cannot leak into release assets.

## The SwiftUI rebuild: restore point and rollback

Pennant for Mac is being rebuilt as a native SwiftUI app over the same server ([SWIFTUI_REBUILD.md](SWIFTUI_REBUILD.md),
D-055). The work happens on `feature/swiftui`, with one PR per milestone into it; `main` is untouched until the owner
approves the final merge. The Electron and React app keeps working on the branch until the cutover PR, the last one,
which deletes it and is a single revert away.

**The restore point** (created 2026-09-25 with the owner's approval, pushed to `origin`):

| Ref | Points at | What it is |
|---|---|---|
| tag `pre-swiftui` (annotated) | `87934cf` | `main` before the rebuild: the Electron + React app |
| branch `archive/electron-react` | `87934cf` | the same commit, as a branch to build from |

Do not move or delete either.

**Rolling back to the Electron app:**

```bash
git switch archive/electron-react
```

```bash
npm ci && npm run desktop
```

Both apps use the same data folder, and every server change on the branch is additive (new tables and files only), so
the Electron app reads the folder as it was. If the Mac app has run on that folder, its first run left a backup of the
irreplaceable files in `backups/pre-swiftui-<date>/` (`history.db`, `settings.json`, `config.json`,
`credentials.json`; `league.db` is re-imported, not backed up). To return to that state, quit both apps and restore it,
either with the Mac app's Settings ▸ Restore backup or by copying the files back into the data folder. A key saved only
in the Mac app's Keychain item is not in the Electron app; enter it again there.

Rating history is kept per save since D-064, in new tables the Electron app doesn't read. The server also writes every
rating snapshot, and its rating-kind stamp, into the Electron app's own name-keyed tables exactly as that app writes
them, so after a rollback it reads every snapshot the Mac app took (with its old defect: two saves of one name share
that history there). A snapshot taken while the league on disk isn't certainly the chosen save's (a save chosen with
one click just after an import) is not written there at all. Each time the GM carries another save's rating history
over, the server first copies `history.db` to `backups/history-before-carry-over-<time>.db` (not again until the next
import, and only the newest three are kept); the app's "Undo carry-over" is the normal way back, and the copy is there
if it is ever needed. The one-time `history-before-save-identity-<time>.db` is never removed. The first time the
server brought earlier rating history over into the new tables it copied `history.db` to
`backups/history-before-save-identity-<time>.db`. To undo that change alone, quit both apps and copy that file back
as `history.db` (removing any `history.db-wal` and `history.db-shm` beside it). Nothing brought over survives the
restore, and neither does anything written since (the Mac app's snapshots, fits and notes); the next start reviews the
earlier history again.

Undoing the cutover after it merges is `git revert` of that one PR.

### The sidecar

The Mac app runs this server as a child process (`server/sidecar.ts`, SWIFTUI_REBUILD.md section 5), from inside its
bundle ("The Mac app" below). To build and run it by hand:

```bash
npm run build:sidecar
```

```bash
npm run sidecar:node
```

The first writes `build/sidecar/` (the bundled server and its worker threads: the two refits, the import's build and
parse worker, and the import's snapshots); the second fetches Node 24.21.0 for
Apple Silicon into `build/node-runtime/pennant-server`, checked against a pinned SHA-256. Both folders are ignored by
Git. To run the bundle, point it at a scratch data folder and send the handshake on stdin; it answers with a
`PENNANT_READY` line holding the port, and every request needs `Authorization: Bearer <token>`:

```bash
echo '{"token":"0123456789abcdef0123456789abcdef"}' | OOTP_FO_DATA_DIR=/tmp/pennant-scratch build/node-runtime/pennant-server build/sidecar/server.cjs
```

That example stops at once, because stdin closes after the one line; the app keeps stdin open for as long as it wants
the server. The bundle loads better-sqlite3 from the repository's `node_modules`, so it needs the Node build of the
native module (`npm run abi:node`), not Electron's.

**The import (N3.5, D-061).** An import builds `league.next.db` in a worker thread and swaps it in with one rename;
the app serves `league.db` read-only. A leftover `league.next.db` is a crashed import's and the next start removes it.
Two environment variables exist for the tests and scripts, never for the app: `OOTP_FO_DB_WRITABLE=1` opens `league.db`
read-write (the tests and `npm run synthetic:league` build their leagues through the server's own connection), and
`OOTP_FO_EXPORT_QUIET_MS` shortens the 10 s an export must stay unwritten before it is read (the tests set 0).
`OOTP_FO_DB_READONLY=1` (the report scripts) is unchanged: read-only, and not even the start-up tidy runs.

A leftover `league.next.db` (about the size of `league.db`) is removed only by this build's start: an earlier build
(the Electron app from before N3.5, or `archive/electron-react`) ignores it, so after the way back it stays until this
build next starts, or until it is deleted by hand (it is never the league; `league.db` is).

To measure an import and the slow pages on a real export, drive the bundled sidecar with the benchmark, on a scratch
data folder only (the export is only read; delete the folder afterwards):

```bash
node scripts/bench-import.mjs --server build/sidecar/server.cjs --data /tmp/pennant-bench --csv "<save>.lg/import_export/csv" --out /tmp/bench.json
```

It prints the import's time, `/api/status` latency during the import, peak memory, how long the refits take to settle,
and each slow route cold and warm. SWIFTUI_REBUILD.md "N3.5" holds the numbers it measured.

The launch budgets (N3.5 Stage B2) are measured on the same scratch folder once it holds an import: each run starts the
bundled sidecar afresh and times launch to ready, launch to the first Morning Report payload, and every department's
report asked again (the server's half of a view switch from the cache). It refuses the repository's `data/` and any
folder under `~/Library/Application Support`:

```bash
node scripts/bench-launch.mjs --server build/sidecar/server.cjs --data /tmp/pennant-bench --runs 3 --out /tmp/launch.json
```

**Finding the save (N3.5 Stage B2, D-063).** The server finds saves under every OOTP version by itself
(`GET /api/v2/saves`), and a first run with no save chosen can choose and import the one that clearly stands out
(`POST /api/v2/setup/automatic`). Both read the real home folder's OOTP saves (file times only); in a test, point
`HOME` at a pretend home (`tests/saveHomeFixture.ts`), never at the real one. The live transaction log's background
copy runs in `build/sidecar/transaction-log-worker.cjs` (and `build/transaction-log-worker.cjs` for Electron), found
beside the bundle like the other workers.

**The data-folder lock.** Every server start, `npm run dev` included, takes `server.lock` in its data folder. A second
server on the same folder refuses to start and names the one holding it. A lock left by a process that has gone is
taken over on the next start; one held by a live process that is not Pennant (a reused process id) needs the file
deleting by hand, as the refusal says.

### The contract and the Swift client

The Mac app's client is generated, never hand-written (SWIFTUI_REBUILD.md section 4.3, D-056). After changing a type
the contract names (anything exported from `server/contract/index.ts`, or an operation in `server/contract/routes.ts`),
rebuild the spec and commit it:

```bash
npm run contract:build
```

Two conventions: a whole number (an id, a count) is typed `Integer` (`server/contract/primitives.ts`), so the Mac app
reads an `Int`; and a generic type is never exported from the contract, only a concrete alias of it
(`export type ClaimRow = Row<Claim>`). The build refuses an exported generic and two different types with one name.

`tests/contract.test.ts` (part of `npm test`) fails when:
- `contract/openapi.json` differs from a fresh build (run the command above and commit the result);
- a `/api/v2` route is registered (on any router, a mounted one included) but not listed in `routes.ts`, or a listed
  operation is not registered (add it, or fix its method or path). Reused legacy routes are checked one way only: a
  listed one must exist, an unlisted one is simply not described;
- a JSON GET's live answer against the synthetic save has a field the type does not describe, or a code its union does
  not list (describe it in the TypeScript type; the spec is checked in its strict form, with enums closed). POSTs are
  checked in the answers that are safe in a temporary data folder (their 400s, and the 200s of `resolve-folder` and
  `save-source`); the 200s of `config` and `import` are not, since they start an import;
- a captured answer or event differs from `contract/fixtures/`, which the Swift tests decode: when the change is
  intended, run `npm run contract:fixtures` and commit the fixtures;
- a `text`, `hint` or `display` string in a `/v2` payload carries a word from `tests/bannedJargon.ts`. The list applies to
  all `/v2` text; before department copy moves (N8) it needs a scoped exception for plain words it would reject.

The Swift package reads the spec through a link (`macos/Packages/PennantAPI/Sources/PennantAPI/openapi.json`), so there
is no second copy to update. `contract:build` also writes the tests' shape contract (`tests/contractShapes/`) into the
package's `ContractShapesTests`. Build and test it on a Mac with Xcode 26 or later:

```bash
cd macos/Packages/PennantAPI && swift build && swift test
```

CI runs the same on `macos-26` (with `--force-resolved-versions`, so a stale `Package.resolved` fails), so a change that
breaks the generated client fails the pull request.

**An interrupted import.** If the server stops while importing, or the import fails partway, `import-in-progress.json` stays in the data folder,
`/api/status` reports `importInterruptedSince`, and the next start imports the export again.

### The Mac app

The Xcode project is `macos/Pennant.xcodeproj` (scheme `Pennant`), over the local packages in `macos/Packages/`
(PennantAPI, PennantKit, PennantDesign, PennantFeatures). The app carries the server inside it, so stage the server first; this runs
`build:sidecar` and `sidecar:node`, then installs the production dependencies for the bundled Node in their own folder
(the repository's `node_modules` is left as it is, whichever ABI it holds):

```bash
npm run mac:stage
```

The build copies `build/macos-server/` into the app and stops, naming that command, when the stage is missing, holds
another version, was made from a different `build/sidecar/` bundle, `package-lock.json` or Node (a content stamp,
`macos/scripts/stage-stamp.sh`), or when any `server/**/*.ts` is newer than the bundle. After changing the server, run
`npm run mac:stage` again. A Debug
build signs with the Apple Development identity on team `6T7RV2A4DQ` if the Mac has it; to build without signing, pass
`CODE_SIGNING_ALLOWED=NO`, and to build without the server (as CI does), `PENNANT_SKIP_SERVER=YES`.

**Run it on a scratch folder, never the real one.** A Debug build reads its data folder from `PENNANT_DEV_DATA_DIR` (or
the launch argument `-PennantDevDataFolder <folder>`; the log goes to `PENNANT_DEV_LOG_DIR`, else `logs/` inside it). To
run it on the real data folder, say so: `PENNANT_DEV_USE_REAL_DATA=1` (or `-PennantUseRealDataFolder YES`). With neither,
a Debug build starts no server and says "No data folder chosen for this development build". A Release build ignores all
of these and uses the real folder. Set them in the scheme's Run environment (in your own, unshared scheme settings) or
launch from a shell. A synthetic league to point it at:

```bash
npm run synthetic:league -- /tmp/pennant-dev
```

Beside `league.db` it writes `export/`, the same league as OOTP's CSV export, for a pretend save to choose: the import
builds a whole new database from an export (D-061), so a save that exports only a token table imports a league with
nothing else in it (no clubs to pick). The tests' pretend saves copy it (`macos/scripts/test.sh`).

```bash
PENNANT_DEV_DATA_DIR=/tmp/pennant-dev "<DerivedData>/Build/Products/Debug/Pennant.app/Contents/MacOS/Pennant"
```

A Debug build finds and chooses an OOTP save by itself (the zero-question first run, D-063) only when it is given a
pretend home to look in, `PENNANT_DEV_HOME` (or `-PennantDevHome <folder>`): the server then looks for saves there and
nowhere else, so a development build never imports the developer's own saves. Without one, a Debug build on a scratch
folder with no save chosen opens Setup and asks. One script does all of it, a synthetic league, a pretend home holding
one pretend save that exports it, and the data folder, log and caches, all inside a scratch folder, and launches the
build by its path (never through LaunchServices, which may open another worktree's build):

```bash
macos/scripts/run-dev.sh /tmp/pennant-dev            # this checkout's Debug build
macos/scripts/run-dev.sh /tmp/pennant-dev <path/to/Pennant.app>
```

A Debug build keeps the Morning Report it received (for the next launch) in `PENNANT_DEV_CACHES_DIR` when set. To see
the kept report as it waits for the fresh one (the synthetic league answers faster than a frame), set
`PENNANT_DEV_HOLD_FRESH_MS=2500`; with `PENNANT_DEV_CAPTURE_DIR=<folder>` the window draws itself to a PNG there when
the report is first drawn updating and when the fresh one has replaced it (the app's own window, no screen recording).
The log's "first Morning Report drawn" line times the first committed frame from the process's start, and the lines
beginning "launch:" time the launch's own steps (the model made and the server started, the launch finished, the main
window's first frame). `-PennantDebugScrollTo <points>` scrolls the Morning Report there once it is drawn, for window
captures of content under the toolbar without any input.

The first start on a folder backs up its irreplaceable files to `backups/pre-swiftui-<date>/` (SWIFTUI_REBUILD.md
section 7.5). The server's log is `server.log` in the log folder (`~/Library/Logs/Pennant/` for a release build; Help ▸
Server Log opens it). A synthetic league has no save chosen, so the Setup window opens: to run the flow, give it a pretend
save, a `.lg` folder whose `import_export/csv/` holds any small CSV (`id,note` and a row or two), by typing its path.
Relaunching restores each window's department, history, inspector and sidebar; add `-ApplePersistenceIgnoreState YES`
to start fresh.

**Tests.** One script runs them all, with output in `build/macos-test/` (summaries and failures are printed):

```bash
macos/scripts/test.sh
```

It writes the synthetic league into a scratch folder, stages the server, runs each package's `swift test` (PennantKit's
and PennantFeatures' include integration tests that start the real staged server; PennantFeatures' runs the Setup flow),
then `xcodebuild test` on the Pennant scheme, each XCUITest on a fresh scratch folder of its own, and extracts the XCUITest
screenshots into `build/macos-test/screenshots/`. The XCUITest runner is sandboxed and cannot create folders, so the
script prepares each UI test's folder (`prepare_ui_test <test method> configured|new`: the league copied in, a pretend
OOTP save, the save chosen or not) and passes only the root; a new UI test needs a line there. Screenshots are the
app's windows only, under their test names (the scheme keeps no system attachments, and the script keeps only the
tests' named shots), with the accessibility audit's findings in `accessibility-audit.txt`. `PENNANT_TEST_NO_PACKAGES=1`
skips the package tests and `PENNANT_TEST_ONLY=PennantUITests/PennantUITests/<test>` runs one UI test.
`PENNANT_TEST_NO_UI=1` skips the XCUITests; `PENNANT_TEST_UNSIGNED=1` builds unsigned. The XCUITests need UI automation,
which the Mac's owner enables once (running the scheme's tests from Xcode asks for it); while they run they drive the
app on screen. **Running them locally is optional** since N6, Stage B1: CI runs them on GitHub's macOS runner, where a
logged-in session no one is using takes the driving, on the synthetic league, with the same script (below).
`PENNANT_TEST_SHARD=<n>` runs one CI shard's tests locally, to reproduce a shard's run. An unsigned build's UI-test runner
(`PENNANT_TEST_UNSIGNED=1`) does not launch on a Mac (the system kills it and says the test file is damaged); only
CI's runner runs it, so build signed to run UI tests locally.

**The Mac app's UI tests on CI.** For pull requests into `feature/swiftui` and by hand from the Actions tab, in parallel
shards (run one after another the suite took about 1 h 50 min). `pennant-mac-ui-build` ("Mac app (XCUITests build)")
writes the synthetic league, stages the server and builds the app with its UI tests once, unsigned
(`PENNANT_TEST_BUILD_ONLY=1`: `xcodebuild build-for-testing`), and hands the products (`Build/Products/` with its
`.xctestrun`, the server inside the app) and the league to the shard jobs as tarballs (the `xcuitest-build` artifact,
kept a day). Each `pennant-mac-ui-shard` job ("Mac app (XCUITests, shard n of N)") unpacks them and runs its share
(`PENNANT_TEST_PREBUILT=1 PENNANT_TEST_SHARD=<n>`: `xcodebuild test-without-building`), each test on its own fresh
folder as locally. Which tests each shard runs, with the seconds each took on the runner, is one file,
`macos/scripts/ui-test-shards.json`; each shard's timeout is about double its expected time (its tests plus
`setupMinutes`). One shard, `catchAll`, also runs every test no shard lists, so a new UI test runs before anyone
assigns it (the build job's log notes it); `tests/uiTestShards.test.ts` checks that every test runs in exactly one shard.
To rebalance after the times change, download a run's logs and run
`node macos/scripts/ui-test-shards.mjs balance <xcodebuild-test.log> [shards] [source]` (longest first, each to the
shard with the least so far; a class of unit tests such as `ScrollClipTests` stays whole). Four shards: a free
account runs at most five macOS jobs at once. Each shard's window screenshots, accessibility audits (the
`[audit]`/`[quit]`/`[palette]`/`[focus]` lines in its log), the launch timing (in the shard that runs
`testLaunchWithKeptPayload`) and its logs, `hang-*.log` included, come back as its own artifact, `xcuitest-shard-<n>`,
laid out as the single job's `xcuitest-screenshots` was; a failed build keeps its logs as `xcuitest-build-logs`. The
gate is the job still named **Mac app (XCUITests on the runner)** (`pennant-mac-ui`), which needs the build and every
shard and fails if any failed, was cancelled or timed out. It is a hard gate since the UI-test health pass (a failing
XCUITest fails the run; making it a required check is a repository setting), and changes nothing on the runner: if its
UI automation refuses, the log says so. By hand, the Actions tab's `only` input runs those tests
(`PennantUITests/PennantUITests/testX`) in a single shard. `pennant-mac` runs the PennantKit, PennantDesign and PennantFeatures tests and builds the app and its UI tests
unsigned, without the server, on every pull request.

**Snapshots.** PennantFeatures' tests also draw the shell (the sidebar with the club card, the main window, each server
state, each Setup step, each Settings tab) in light and dark at their real sizes into `build/macos-snapshots/`, from
`contract/fixtures/`. They are for looking at, not compared; CI skips them. To draw only them:
`cd macos/Packages/PennantFeatures && swift test --filter SnapshotTests`. The design language's pictures are the
`design-*` files: the Morning Report as designed (the slots the server does not serve yet drawn from
`DesignFixtures`, made-up data in PennantDesign), a report, the ⌘K palette, a pinned claim and each component, in the
club's colours, the example pack and the example art pack, light, dark, Increase Contrast and Reduce Transparency.
Offscreen drawing cannot draw the system's glass, so the real look is in the XCUITest screenshots.

**Previews.** Every PennantDesign component has a `#Preview` in `Previews.swift` (Xcode's canvas, the example pack's
colours, `DesignFixtures`), and the Morning Report has one as designed; the shell's previews are in
`Shell/Previews.swift`. A preview never shows a sentence the server would not serve: fixture text is passed through
`DesignFixtures.served(_:)`, and the String Catalog check refuses a `Text(verbatim:)` literal anywhere else.

The unknown-last comparator's cases (`contract/fixtures/sort-cases.json`) are shared: `tests/sortCases.test.ts` runs them
against a TypeScript reference, PennantKit against the app. The String Catalog is checked against the banned-jargon list
by `tests/stringCatalog.test.ts`, which also fails when a label written in the Swift sources (a `Text`, `Button`,
`Label`, `Section`, a `title:` and the like) is missing from the app's catalog: the packages' views look their labels up
there.

**Accessibility looks without changing the Mac's settings.** A Debug build takes `-PennantDebugAppearance
increasedContrastLight` (or `increasedContrastDark`), which draws the app's own pieces as Increase Contrast does (the
theme's 7:1 colours, the borders) with AppKit in the high-contrast appearance, and `-PennantDebugReduceTransparency YES`,
which draws the app's own pieces opaque. The system's own glass follows only the Mac's real settings, so check those by
hand. `-PennantDebugActivate YES` brings a Debug build launched from a script to the front. None of these exist in a
release build.

### Making a theme pack

A theme pack (D-062) is how a club looks in the Mac app: the masthead at the top of a report, the club card, the one
floating control's tint. Every club already has one with no file, its own colours from the save; a pack is for another
look, a City Connect set, say. Pennant ships no club's art: packs you make are for your own use and stay in your data
folder.

1. Make a folder in the data folder's `theme-packs/` (Settings ▸ Appearance shows where, with Show in Finder), named for
   the pack's id: lower-case letters, digits and dashes, not `club-colors`.
2. Put a `pack.json` in it. `docs/theme-packs/sunset-series/pack.json` is a complete example with made-up colours:

   | Field | What it is |
   |---|---|
   | `format` | `1` |
   | `id` | the folder's name |
   | `name` | what Settings calls it, up to 40 characters |
   | `version` | yours, up to 20 characters (`"1.0"`) |
   | `club` | the team id it is made for (as the save numbers clubs), or `"any"` |
   | `light`, `dark` | the colours for each appearance (below), every one written `#rrggbb` |
   | `lightIncreasedContrast`, `darkIncreasedContrast` | optional: the colours with Increase Contrast; left out, Pennant makes them from `light` and `dark` |
   | `logo`, `art` | optional: a `.png` or `.jpg` in the folder itself (a link to a file elsewhere is refused, as is a pack folder or `pack.json` that is a link), at most 2 MB (the masthead's logo, and art drawn at its trailing side, past the text, faded in from the middle; `docs/theme-packs/aurora-nights` shows one, made by `AuroraArt` and remade with `PENNANT_RENDER_ART=<path> swift test --filter AuroraArtTests` in PennantDesign) |

   Each appearance names `mastheadTop` (under the toolbar, where macOS writes the window's title: nearly white in light,
   nearly black in dark), `masthead` (one to four colours, from the masthead's leading top to its trailing bottom),
   `mastheadText` and `mastheadSecondaryText` (on them), `accent` and `accentText` (the club's accent on the window, and
   text on it), `tint` and `tintText` (the floating control), and `card` and `cardText` (the club card).
3. Every piece of text must read on its colour: 4.5:1, 7:1 with Increase Contrast, the masthead's text on every colour and
   every blend between two neighbours, the accent on the window's backgrounds, and the masthead's top against the title
   (17:1 against black in light, 14:1 against white in dark). A pack that falls short is refused whole: Settings ▸
   Appearance lists it with the first thing wrong, and every finding is in its help tag. Nothing half-applies.
4. Choose it in Settings ▸ Appearance ▸ Theme (the club's own colours are "Team colors"). Packs are read as they are: a
   fix is seen the next time Settings or a window asks.

To check packs outside the app: `npm run check:theme -- <league.db> <theme-packs folder>` (the repository's examples are
always checked). A pack's accent also washes the cards, chips and the roster diagram faintly and tints its strips and
bars (D-062), so a pack made for the masthead alone wears the whole design.

## Versions

Pennant has its own version lineage starting at **0.1.0** (D-049); it is unrelated to upstream's numbers.

- **`package.json` `version` is the only source.** `package-lock.json` mirrors it. The server reads it through
  `server/appInfo.ts` (from source) or from Electron's `app.getVersion()` (packaged) and serves it on `/api/status`;
  the header shows it. Nothing else keeps a copy, and `tests/projectIdentity.test.ts` fails if the lockfile or the
  changelog disagrees.
- To release: move the `[Unreleased]` notes in [../CHANGELOG.md](../CHANGELOG.md) under a new `## [x.y.z] - date`
  heading, then

  ```bash
  npm version <x.y.z> --no-git-tag-version   # updates package.json and the lockfile only
  ```

  commit, and tag it **`pennant-v<x.y.z>`**:

  ```bash
  git tag pennant-v<x.y.z> && git push origin pennant-v<x.y.z>
  ```

  The release workflow refuses a tag that is not `pennant-v` + `package.json`'s version.
- Below 1.0 a minor bump may change behavior. 1.0 is reserved for a later stability milestone.
- Use plain `X.Y.Z` versions for now. A prerelease version (`0.2.0-beta.1`) makes electron-updater take a different
  path that requires the release tag itself to be valid semver, which `pennant-v…` is not. Solve that (a custom
  provider, or a prerelease channel on a different feed) before shipping one.

### Release tags: `pennant-v<version>`, never `v<version>`

The upstream project's tags are `v0.1.0` … `v0.40.1`. Pennant's tags carry the `pennant-` prefix so that they can never
collide with those, and so the release workflow (`tags: ['pennant-v*']`) can never be triggered by one of them, even in
a clone that also holds the `upstream` remote's tags. The prefix lives in `server/project.ts` (`RELEASE_TAG_PREFIX`, used
for the in-app release-notes link) and is spelled out in `release.yml` and `electron-builder.yml`
(`publish.tagNamePrefix`); a test keeps the three in agreement.

The updater does not care what the tag is called. On a stable version it asks GitHub for the latest release, downloads
from whatever tag that has, and reads the version from `latest*.yml`.

Still worth doing in a clone with an `upstream` remote, so upstream's tags stay out of `git tag` altogether:

```bash
git config remote.upstream.tagOpt --no-tags
```

Pennant's own repository has no upstream tags and never should. Do not create, move or delete tags without the owner's
approval.

## Releases

`.github/workflows/release.yml` runs on a `pennant-v*` tag, or manually from the Actions tab (which builds installers
without publishing).

1. **Tests** (Linux) — typecheck and tests, and, on a tag, that the tag equals `pennant-v` + `package.json`'s version.
2. **macOS** and **Windows** — separate jobs on purpose, so Apple signing credentials never reach the Windows job.
   **Pennant for Mac** (`pennant-mac`, the SwiftUI app) builds beside them until the N15 cutover; see "Releasing
   Pennant for Mac" below.
3. **Publish** — creates the release (titled "Pennant x.y.z") and attaches installers, blockmaps and the update
   manifests (`latest-mac.yml`, `latest.yml`), retrying transient failures. The manifests must be present or clients
   never learn a release exists.

The updater reads Pennant's releases only: `electron-builder.yml` names the repository explicitly, and
`server/project.ts` holds the same address for the links in the app.

### macOS signing — current status

**Not configured.** The repository has none of the Apple secrets, so the macOS job builds an unsigned app and its
"Verify the app is signed and notarized" step cannot pass. That is correct: an unnotarized app would be rejected by
Gatekeeper on a user's machine, and the check is deliberately not weakened to turn CI green. Windows builds are
unsigned by design and only show a SmartScreen prompt.

A signed macOS release needs:

- An Apple Developer Program membership and a *Developer ID Application* certificate exported as a `.p12`.
- These repository secrets: `APPLE_CERTIFICATE_P12` (base64 of the `.p12`), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`. The workflow already maps them to electron-builder's variables.
- The bundle id is already Pennant's (`com.dakotawise.pennant`); sign with a Developer ID certificate under
  your own team before the first signed release.

The same five secrets sign and notarize Pennant for Mac, which also needs `SPARKLE_ED_PRIVATE_KEY` and the
public key file; the one-time setup below makes all of them.

### Releasing Pennant for Mac

The SwiftUI app (D-076) ships as a notarized DMG on the same GitHub release as the Electron installers, and updates
itself with Sparkle 2 from an appcast attached to that release. Everything runs in `.github/workflows/release.yml`,
through the scripts in `macos/scripts/releasing/`:

| Step | Script | What it does |
|---|---|---|
| Build | `build-app.sh` | The Release configuration, unsigned, with the staged server (`npm run mac:stage`). The version comes from `package.json` at build time, for the app and each extension, and is checked (`version.sh --check-app`). Writes `entitlements.tsv`: each target's entitlements file as the project names it, its build settings filled in (`entitlements.mjs`; the App Group, with the signing team from `APPLE_TEAM_ID`). |
| Sign | `sign-app.sh` | Inside out (SWIFTUI_REBUILD.md section 5.2): each Mach-O file in `Resources` (the `.node` files), the Node binary with only `allow-jit` and `allow-unsigned-executable-memory`, each framework's helpers then the framework (Sparkle), each app extension with its own entitlements, the app last with the hardened runtime and no JIT or sandbox entitlement (refused if present). Ends with `codesign --verify --deep --strict`. |
| Notarize | `notarize.sh` | `notarytool submit --wait` with the app-specific password, then `stapler staple` and `validate`. Run on the app, then on the DMG. A rejection prints Apple's log. |
| DMG | `make-dmg.sh` | `hdiutil`: the app and an `/Applications` link, compressed, signed with the Developer ID. Named `Pennant-for-Mac-<version>.dmg` (the Electron DMG is `Pennant-<version>-<arch>.dmg`). |
| Appcast | `make-appcast.sh` | Sparkle's `generate_appcast` (`fetch-sparkle-tools.sh`: Sparkle 2.10.0, checked against a pinned SHA-256) signs the DMG with the EdDSA private key, read from standard input, and writes `appcast.xml` with the release's body as Markdown notes. |
| Secrets | `check-secrets.sh`, `ci-keychain.sh` | Name every missing secret before anything is signed; load the certificate into a throwaway keychain on the runner (CI only) and remove it afterwards. |

The jobs: `pennant-mac` (macOS 26; on a `pennant-v*` tag or by hand) runs `tests/macRelease.test.ts`, builds, packs an
unsigned DMG for inspection (the `pennant-mac-unsigned` artifact, never published), then checks the secrets, signs,
notarizes, packs and verifies (`codesign`, `spctl` for the app and the DMG, `stapler validate`), and uploads the
`pennant-mac` artifact. On a tag, `release` attaches that DMG with the Electron installers, and `pennant-mac-appcast`
writes the appcast and attaches it. The app reads
`https://github.com/dakota86005/Pennant/releases/latest/download/appcast.xml`: GitHub always serves the newest
published release's asset there, so the address never changes and nothing else needs hosting. Release builds carry
`SUFeedURL` and `SUPublicEDKey` (set by the "Embed the server" phase); Debug builds carry neither and never check.

**Without the secrets** the job builds and packs the unsigned DMG, then fails at "Check the signing and notarizing
secrets", naming each missing one; the appcast job fails naming `SPARKLE_ED_PRIVATE_KEY`. Nothing is faked.

**A dry run on any Mac** (no secrets, no keychain, nothing launched or notarized):

```bash
npm ci && npm run mac:stage
macos/scripts/releasing/dry-run.sh /tmp/pennant-dry-run   # Pennant.app signed ad hoc, and the DMG
```

The ad-hoc app is for inspection only: with the hardened runtime and no team, macOS would refuse its native module.

#### The owner's one-time setup

Only the owner does this, on his own Mac. No one else handles the certificate, the passwords or the private key, and
none of them is ever committed. `gh` must be signed in to an account that can administer `dakota86005/Pennant`.

1. **Export the Developer ID Application certificate.**
   1. Open Keychain Access, choose the login keychain, and select My Certificates.
   2. Find "Developer ID Application: … (6T7RV2A4DQ)" and expand it; it must have a private key under it. If there is
      none, create it in Xcode ▸ Settings ▸ Accounts ▸ (the team) ▸ Manage Certificates ▸ + ▸ Developer ID Application.
   3. Select the certificate (not the key), choose File ▸ Export Items…, pick Personal Information Exchange (.p12),
      save it as `~/Desktop/pennant-developer-id.p12`, and give it a new strong password. Keep that password for step 5.
2. **Make an app-specific password** for notarization: sign in at account.apple.com with the Apple ID of the developer
   account, open Sign-In and Security ▸ App-Specific Passwords, add one named "Pennant notarization", and copy it.
3. **Note the Team ID**: `6T7RV2A4DQ` (developer.apple.com ▸ Account ▸ Membership details; it is the project's
   `DEVELOPMENT_TEAM`).
4. **Make Sparkle's EdDSA key pair.** From the repository root:

   ```bash
   SPARKLE="$(macos/scripts/releasing/fetch-sparkle-tools.sh)"   # the pinned Sparkle 2.10.0 tools
   "$SPARKLE/bin/generate_keys" --account pennant       # makes the pair, keeps the private key in your login keychain
   "$SPARKLE/bin/generate_keys" --account pennant -p > macos/Support/sparkle-public-key.txt   # the public key, one line
   "$SPARKLE/bin/generate_keys" --account pennant -x ~/Desktop/sparkle-private-key           # a copy of the private key
   ```

   Commit `macos/Support/sparkle-public-key.txt` (it is public; every Release build puts it in the app). **Back up the
   private key** (a password manager): if it is lost, apps already installed can never accept another update.
5. **Add the six repository secrets** (each command reads the value from a file or asks for it, so nothing lands in
   the shell history):

   ```bash
   R=dakota86005/Pennant
   base64 -i ~/Desktop/pennant-developer-id.p12 | gh secret set APPLE_CERTIFICATE_P12 -R $R
   gh secret set APPLE_CERTIFICATE_PASSWORD -R $R          # the .p12 password from step 1
   gh secret set APPLE_ID -R $R                            # the developer account's Apple ID email
   gh secret set APPLE_APP_SPECIFIC_PASSWORD -R $R         # from step 2
   gh secret set APPLE_TEAM_ID -R $R --body 6T7RV2A4DQ
   gh secret set SPARKLE_ED_PRIVATE_KEY -R $R < ~/Desktop/sparkle-private-key
   gh secret list -R $R                                    # the six names, no values
   ```

6. **Delete the exported files**: `rm ~/Desktop/pennant-developer-id.p12 ~/Desktop/sparkle-private-key` (the
   certificate and the key stay in the login keychain and the backup).
7. **Try it without releasing**: GitHub ▸ Actions ▸ Pennant release ▸ Run workflow, on the branch. `pennant-mac`
   should pass and leave a signed, notarized DMG as the `pennant-mac` artifact. A run by hand publishes nothing.

#### Cutting a release

1. Move the `[Unreleased]` notes in `CHANGELOG.md` under the new version, run `npm version <x.y.z>
   --no-git-tag-version`, commit, and merge.
2. The owner pushes the tag: `git tag pennant-v<x.y.z> && git push origin pennant-v<x.y.z>`.
3. The workflow tests, builds the Electron installers and Pennant for Mac, publishes the release (generated notes),
   then attaches `appcast.xml`. Edit the release's body before the appcast job runs to change what Sparkle shows, or
   edit it afterwards and re-run that job.
4. The release check (SWIFTUI_REBUILD.md section 8): install the DMG on the owner's Mac and his brother's, and update
   to it through Sparkle from the version before.

### Application id and compatibility holds

The **application id** is `com.dakotawise.pennant` (D-049). It is the macOS bundle id and the Windows install identity.
It was upstream's `com.lsukev.ootpfrontoffice` until the first installer was about to be published, which is the last
moment it can change for free: on macOS a new id is a new app (the folder-access permission is asked for again) and it
installs beside, not over, an old copy. **Do not change it again once a Pennant installer has been published.** It does
not name the user-data folder, so it is independent of the hold below.

One inherited identifier is held on purpose (D-049) and pinned by a test:

| Identifier | Where | Why it is held |
|---|---|---|
| `name: ootp-front-office` | `package.json` | Electron names the desktop **user-data folder** from it (the bundled `package.json` has no `productName`; checked in a real build), so it must not change without a migration, which does not exist. Changing it would point the app at a new, empty folder, and the keychain entry for a stored API key is presumed keyed to the same app identity. |

The `OOTP_FO_*` environment variables (`OOTP_FO_DATA_DIR`, `OOTP_FO_APP_ROOT`, `OOTP_FO_BIND`, `OOTP_FO_ALLOWED_HOSTS`,
`OOTP_FO_API_PORT`, `OOTP_FO_UPDATER_LOG`) are user-facing configuration people keep in their shell, and the `data/`
layout is persisted state; both are kept for the same reason. No data migration is attempted in this project's current
phase.

## Brand assets

The owner-supplied masters are in `docs/brand/`. `build/icon.png` (the installer icon, 1024 px) and
`public/favicon.png` (the browser tab and the in-app mark) are mechanical crops and resizes of the mark, not redraws.
Anything better than that (vector masters, a rounded-square macOS variant, hand-exported `.icns` and `.ico`) has to
come from the owner.
