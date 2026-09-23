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
