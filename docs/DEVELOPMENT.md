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
npm run check:theme         # generated team-palette contrast
npm run calibrate           # scouting constants against league history (CALIBRATION.md)
npm run farm:base-rate      # how often Minor League Operations raises something
npm run farm:usage-window   # re-measures the provisional windowed-usage constants
```

Point them at a database with `OOTP_FO_DATA_DIR=<directory containing league.db>`.

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

Undoing the cutover after it merges is `git revert` of that one PR.

### The sidecar

The Mac app runs this server as a child process (`server/sidecar.ts`, SWIFTUI_REBUILD.md section 5). Until the Swift
app exists (N3), build and run it by hand:

```bash
npm run build:sidecar
```

```bash
npm run sidecar:node
```

The first writes `build/sidecar/` (the bundled server and its two refit workers); the second fetches Node 24.21.0 for
Apple Silicon into `build/node-runtime/pennant-server`, checked against a pinned SHA-256. Both folders are ignored by
Git. To run the bundle, point it at a scratch data folder and send the handshake on stdin; it answers with a
`PENNANT_READY` line holding the port, and every request needs `Authorization: Bearer <token>`:

```bash
echo '{"token":"0123456789abcdef0123456789abcdef"}' | OOTP_FO_DATA_DIR=/tmp/pennant-scratch build/node-runtime/pennant-server build/sidecar/server.cjs
```

That example stops at once, because stdin closes after the one line; the app keeps stdin open for as long as it wants
the server. The bundle loads better-sqlite3 from the repository's `node_modules`, so it needs the Node build of the
native module (`npm run abi:node`), not Electron's.

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
