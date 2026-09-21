# Pennant project consolidation

Status: **built, owner decisions applied 2026-09-21 (§12), uncommitted at the time of writing** (branch `feature/pennant-project-consolidation`, from `main` at `52dc14b`, the merge of PR #6).
This phase is repository, identity and workflow work. It changes no baseball behavior: Player Development,
MLB Operations, Minor League Operations, Player Rights, scouting models, philosophy, calibration and every
threshold are untouched, and no OOTP save is read or written by anything here.

The record has four parts: the baseline and the legacy-reference audit (what was found and what was done about
each kind), the Git audit, the documentation classification, and the brand-asset audit. Decision D-049 records
the version lineage and the compatibility holds.

## 1. Baseline (before any change)

| Item | Value at `52dc14b` |
|---|---|
| npm package `name` | `ootp-front-office` |
| npm `version` | `0.27.2` (the upstream release the fork was cut from) |
| Electron `productName` | `OOTP Front Office` |
| Electron `appId` | `com.lsukev.ootpfrontoffice` |
| Artifact names | `${name}-${version}-${arch}.${ext}` → `ootp-front-office-0.27.2-arm64.dmg` |
| Windows shortcut / DMG title | `OOTP Front Office` |
| Workflow | `.github/workflows/release.yml`, "Build desktop apps", triggered by `v*` tags or manually |
| Workflow artifacts | `macos`, `windows` |
| README title | `# OOTP Front Office` |
| Browser tab / window title | `OOTP Front Office` (`index.html`, `electron/main.ts`) |
| App masthead | `Front Office` / `OOTP Companion`, a ⚾ emoji |
| Dev commands | `npm run dev` (`concurrently` of `tsx watch server/index.ts` and `vite`); `.claude/launch.json` carried two configs, one known broken |
| Remotes | `origin` = `dakota86005/ootp-front-office`; `upstream` = `lsukev/ootp-front-office` |
| Tags | `origin`: none, and no GitHub releases. `upstream`: 90 (`v0.1.0` … `v0.40.1`); none fetched locally |
| Desktop user data | `~/Library/Application Support/ootp-front-office`, named from the npm `name`, not `productName` |
| Validation | `tsc` clean; 133 files / 1736 tests; `npm run build` succeeds |

## 2. Legacy-reference audit

127 lines outside the archived release notes matched `front office`, `frontoffice`, `lsukev`, `OOTP_FO` or
`ootpfrontoffice`. They fall into the categories below. "Front office" as a *baseball concept* (a club's front
office, "Scanning 29 front offices", the staff voice "the front office", the AI's role "front-office analyst") is
ordinary English and is deliberately kept: the product is what is renamed, not the noun.

| Reference | Location | Category | Current purpose | Action | Rationale |
|---|---|---|---|---|---|
| `OOTP Front Office` title | `index.html`, `electron/main.ts` (window title, startup error) | A user-facing | Browser tab, window title, error dialog | RENAME | Product name |
| `Front Office` / `OOTP Companion` masthead | `src/App.tsx` | A | The app's wordmark | RENAME (owner's mark + `Pennant`) | Product name |
| `Front Office` nav group, chat drawer title | `src/App.tsx` | A | Navigation label, staff chat header | RENAME (`Baseball Operations`, `Your Staff`) | Product architecture; the group holds MLB Operations, contracts, trades |
| `Front Office / Organizational Philosophy`, `Front Office Policies` | `src/pages/Philosophy.tsx` | A | Page title, section heading | RENAME | Old feature framing |
| `Front Office does not substitute…` | `src/pages/Development.tsx` | A | Visible evidence note | RENAME | Product name in copy |
| `a Front Office summary of visible tools` | `server/scoutedEvidence.ts`, `docs/ARCHITECTURE.md` | A/E | Describes the composite | RENAME | Product name in copy |
| AI prompt "inside OOTP Front Office" | `server/staff.ts` | A | Persona prompt | RENAME | Product name; no test pins the string |
| `Signal` glossary entry | `src/glossary.ts` | E dead | Tooltip for a column that no longer exists (the promotion signal was removed in D-044) | DELETE | Obsolete terminology |
| `prospect signals` (Storylines hint) | `src/pages/Storylines.tsx` | E | Copy | RENAME (`prospect reports`) | Obsolete terminology |
| Dashboard briefing blurb `An AI assistant-GM digest…` | `src/pages/Dashboard.tsx` | A | Copy | RENAME | Avoids AI-first framing (D-001) |
| `productName: OOTP Front Office`, NSIS `shortcutName`, DMG title | `electron-builder.yml` | B | Installer/app naming | RENAME → `Pennant` | Owns no data path; verified separately from `name` |
| `artifactName: ${name}-…` | `electron-builder.yml` | B | Release asset names | RENAME → literal `Pennant-${version}-${arch}.${ext}` | `${name}` is compat-held, so the literal decouples the asset name from it |
| Icon `docs/icons/frontoffice.png` | `electron-builder.yml`, `index.html` | B/E | App icon | REPLACE with owner's Pennant mark | See §5 |
| Workflow `name`, artifact names | `.github/workflows/release.yml` | B | CI labels | RENAME workflow display name; artifact names `macos`/`windows` are neutral and stay | Nothing to rename in them |
| npm `name: ootp-front-office` | `package.json`, `package-lock.json` | C compat | **Names the Electron userData folder** (`app.name` falls back to `name`: the built app's bundled `package.json` has no `productName`, verified in a real `app.asar`). The keychain entry for a stored API key is presumed keyed the same way (not verified) | KEEP FOR COMPATIBILITY | Renaming points the app at a new, empty folder instead of the user's 2.5 GB one; needs a migration this phase does not build |
| `appId: com.lsukev.ootpfrontoffice` | `electron-builder.yml` | C compat → decided | macOS bundle id, Windows install identity, per-app OS permissions | **RENAME → `com.dakotawise.pennant`** (owner decision 2026-09-21, §12) | Held in the first pass because changing it has a user cost once installers exist. None exists, it does not name the data folder, and upstream's id carried upstream's author into Pennant's app identity |
| `copyright: Kevin Ivy` | `electron-builder.yml`, `LICENSE` | D attribution | MIT notice | KEEP FOR ATTRIBUTION | The license requires the notice to stay. Whether to add a Dakota Wise copyright line is the owner's legal statement and was not made |
| `OOTP_FO_*` variables (`DATA_DIR`, `APP_ROOT`, `PORT`, `BIND`, `ALLOWED_HOSTS`, `EMBEDDED`, `UPDATER_LOG`) | `server/`, `electron/`, `scripts/`, `tests/`, README | C compat | User-set configuration people put in their shell | KEEP FOR COMPATIBILITY | Renaming silently breaks existing setups for no user benefit |
| `data/` layout, `league.db`, `history.db`, `port.json` | `server/` | C compat | Persisted state | KEEP | Migration-sensitive |
| Test temp prefix `ootp-fo-test-` | `tests/fixture.ts` | C/internal | Temp dir name | KEEP | Harmless, internal |
| `lsukev/ootp-front-office` in the Help menu and the updater's release links | `electron/main.ts`, `electron/updater.ts` | B **defect** | Sent Pennant users to the upstream project's releases and release notes | RENAME → Pennant's repo (one constant, `server/project.ts`); upstream stays credited in README and as a Help-menu link | The feed was inferred from the git remote at build time while the links were hard-coded to another repository; the feed is now named explicitly too |
| `lsukev/…` raw-image instructions | `docs/screenshots/README.md` | E | Upstream screenshot publishing note | DELETE with the folder | See §4 |
| `Fork` / credits text | `README.md` | D | Attribution | KEEP FOR ATTRIBUTION, rewrite | Rewritten in Pennant's voice; never removed |
| README title and prose | `README.md` | A | Landing page | RENAME / REWRITE | §5 of the phase |
| `Front Office` in the durable docs | `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md`, `docs/PROJECT_STATE.md`, `docs/CALIBRATION.md` | A | Product name | RENAME where it names the product | Historical decision *titles* that use the noun are kept |
| Root `CHANGELOG-<version>.txt` (54), `FORUM_POST*.{md,txt}` | repo root | D attribution / E stale | Upstream's release notes and forum posts for upstream 0.4–0.27.2 | MOVE to `docs/upstream/` | They are upstream history, not Pennant's; they collided with the new `CHANGELOG.md` and misdescribed the product from the root |
| `docs/screenshots/*` | `docs/` | E dead | Three screenshots of the upstream UI, including the removed promotion-signal table; referenced by nothing | DELETE | Stale imagery presented as current |
| `Storylines` category `'Front Office'` (an enum in the AI schema, an icon key) | `server/storylines.ts`, `src/pages/Storylines.tsx` | C | Persisted storyline category | KEEP | A persisted value and generic baseball sense |
| Generic prose ("your front office", "Scanning 29 front offices", "Message your front office") | `src/`, `server/` | ordinary English | Baseball concept | KEEP | Not branding |

## 3. Git branch and tag audit (nothing deleted)

Every merge on `main` was a merge commit, so `merged` below is exact (`git merge-base --is-ancestor`).

| Branch | Merged into main? | Unique commits | Historical value | Recommended action |
|---|---|---|---|---|
| `feature/evidence-boundary` (local + origin) | yes (PR #1) | 0 | Low: fully in `main` | SAFE TO DELETE LATER |
| `feature/player-state-foundation` (local + origin) | yes (PR #2) | 0 | Low | SAFE TO DELETE LATER |
| `feature/player-rights` (local + origin) | yes (PR #3) | 0 | Low | SAFE TO DELETE LATER |
| `feature/mlb-operations-v2` (local + origin) | yes (PRs #4, #5) | 0 | Low. It carried two PRs, so its name no longer says what it holds | SAFE TO DELETE LATER |
| `feature/farm-windowed-usage` (local + origin) | yes (PR #6) | 0 | Low | SAFE TO DELETE LATER |
| `origin/feature/mlb-operations` | **no** | 10 | **High.** The pre-v2 MLB Operations branch. Audited end to end and deliberately not merged (`docs/MLB_OPERATIONS.md` §2, D-024); the audit reads it with `git show origin/feature/mlb-operations:<path>`, so the doc depends on it staying reachable | ARCHIVAL VALUE: keep. If it is ever retired, first tag it (`archive/mlb-operations-v1`) so those `git show` references keep working |
| `feature/pennant-project-consolidation` (local) | n/a (this phase) | this phase | n/a | KEEP until merged |
| `upstream` remote branches | n/a | n/a | Upstream's own history and three dependabot branches; not Pennant's | KEEP untouched |

Tags: `origin` has **none** and no GitHub releases, so no installer has ever been published from Pennant's
repository. `upstream` has 90 (`v0.1.0` … `v0.40.1`), none present locally. No tag was created, moved or
deleted, and no history was rewritten. Pennant's own tags are `pennant-v<version>` so they cannot overlap upstream's
(§12, D-049).

## 4. Documentation classification

| Document | Class | Note |
|---|---|---|
| `AGENTS.md` | Authoritative current | Agent entry point; product name updated |
| `docs/ARCHITECTURE.md` | Authoritative current | Product name updated |
| `docs/DECISIONS.md` | Authoritative current | D-049 added |
| `docs/ROADMAP.md` | Authoritative current | Product name updated; stale branch wording removed |
| `docs/PROJECT_STATE.md` | Authoritative current, point in time | Rewritten header/snapshot: it still described `feature/farm-windowed-usage` as the inspected branch and "this branch" for work that is on `main` |
| `docs/MLB_OPERATIONS.md`, `docs/MINOR_LEAGUE_OPERATIONS.md`, `docs/ROSTER_REVIEW.md`, `docs/CALIBRATION.md`, `docs/BEHAVIOR_CASES.md` | Authoritative current subsystem docs | Also carry design history; branch names inside them are the record of where the work was done and are left as written |
| `docs/MLB_OPERATIONS_HARDENING.md` | Historical design record | A completed phase; its outcomes live in PROJECT_STATE and D-039 to D-043 |
| `docs/RIGHTS_RESEARCH.md` | Historical design record with live findings | The experiments behind D-023; still cited for rule facts |
| `docs/CALIBRATION_RUN.txt` | Historical record | Raw output that `server/calibration.ts` stamps point at; must stay |
| `CHANGELOG-*.txt`, `FORUM_POST*` (root) | Historical, upstream | Moved to `docs/upstream/` |
| `docs/screenshots/` | Obsolete | Deleted |
| `docs/PENNANT_CONSOLIDATION.md` | Phase record | This file |

Nothing was merged into another document: every surviving file has a distinct owner. `docs/README.md` is the
index that states the classes above so a reader does not have to infer them.

## 5. Brand-asset audit

| Surface | Before | After |
|---|---|---|
| App icon (`electron-builder.yml`) | `docs/icons/frontoffice.png`, upstream's art, 2048 px | The owner's Pennant mark, centred and padded to 1024 px as `build/icon.png` (mechanical resize, no redraw) |
| Favicon (`public/favicon.png`) | Downscale of the same upstream art | The Pennant mark, trimmed and scaled |
| Masthead | ⚾ emoji + text | The Pennant mark + `Pennant` |
| README hero | none | The owner's wordmark, `docs/brand/pennant-wordmark.png` |
| Master art | none in the repo | `docs/brand/pennant-mark.png` and `pennant-wordmark.png` (the transparent originals the owner supplied) |
| Tray/menu/splash icons | none exist | not applicable |

Still wanted from the owner: vector or higher-resolution masters (both supplied files are 1254 px and 2000 px
rasters with soft edges), a macOS-style rounded-square variant if a container is wanted around the mark, and a
Windows `.ico` and macOS `.icns` exported by hand if `electron-builder`'s automatic conversion is not good enough
at 16–32 px.

## 6. Development workflow: before and after

**Before.** `npm run dev` ran `concurrently` over `tsx watch server/index.ts` and `vite`. The server read the generic
`PORT` (default 5178) and Vite had a hard-coded 5173. A tool that exports `PORT=5173` to the whole process (the preview
harness does) therefore started both on 5173; the proxy still pointed at 5178, where nothing listened, so every `/api`
call failed. That was reproduced exactly (`/api/status` through Vite → 500 with nothing on 5178) before it was fixed.
`.claude/launch.json` carried a second, "one port" configuration that existed only to route around this.

**After.** One command, `npm run dev`. `scripts/devPorts.ts` decides both ports and both halves read it: `PORT` moves the
page, `OOTP_FO_API_PORT` moves the API, the API never reads `PORT`, and the two can never be equal. The API half is
`scripts/dev-server.ts`; Vite runs with `strictPort` so a busy port is an error instead of a silent move. Re-run with
`PORT=5173`: Vite 5173, API 5178, `/api/status` → 200 through the proxy. `npm start` (one process) still honors `PORT`.
`.claude/launch.json` has the single working configuration `pennant`. `tests/devPorts.test.ts` pins the resolver, the
`PORT=5173` case, the Vite proxy and `strictPort`, and that `dev:server` goes through the pinning entry.

## 7. Version: every owner

`package.json` `version` is the only source (now `0.1.0`); everything else derives from it or is checked against it.

| Consumer | How |
|---|---|
| `package-lock.json` (`version`, `packages[""].version`) | Written by `npm version --no-git-tag-version`; a test fails on drift |
| `server/appInfo.ts` → `/api/status` `app.version` | Reads `package.json`; in the packaged app Electron's `app.getVersion()` is handed over as `OOTP_FO_APP_VERSION` |
| Header (`OOTP Companion · v0.1.0`) | Reads `status.app.version` |
| Desktop Settings → Updates panel | `app.getVersion()` (unchanged) |
| electron-builder | Reads `package.json`; `CFBundleShortVersionString` is `0.1.0` in a real build; artifact names use `${version}` |
| Release workflow | The Tests job fails a `v*` tag that differs from `package.json` |
| `CHANGELOG.md` | The newest `## [x.y.z]` heading must equal it (test) |

There was no About page and no version endpoint before; the header and `/api/status` now carry it, and the Settings
update panel (desktop only) already did.

## 8. Release workflow

`release.yml` was renamed to "Pennant release", gained the tag-equals-version guard, and documents why the macOS
verification is not weakened. `ci.yml` is new: typecheck, tests and build on pull requests and pushes to `main`, with
read-only permissions and no signing material. **macOS signing is not configured** (no Apple secrets); a macOS release
cannot pass until the five secrets in DEVELOPMENT.md exist. The workflow now triggers on `pennant-v*` tags only (§12). Nothing was fabricated or weakened. Release notes still use
`--generate-notes`; feeding the changelog section in would need a checkout step in the publish job and was left alone.

## 9. GitHub repository rename: recommendation (not performed)

Recommend renaming `dakota86005/ootp-front-office` to **`pennant`** — the short name of the product, and no longer
upstream's name for upstream's product. `pennant-ootp` is the fallback if `pennant` is taken or too generic to search for.
Do it **before the first release**, when it is cheapest (the `appId` question is settled; §12).

Migration if renamed: GitHub redirects the old web and git URLs (until something new takes the old name), so nothing
breaks at once, but these should be edited to match — the local `origin` URL, `package.json` `repository` and
`homepage`, `electron-builder.yml` `publish.repo`, `server/project.ts` `PROJECT_URL` (the test compares the two), the
README clone URL and the changelog compare links. No workflow needs editing (they use `${GITHUB_REPOSITORY}`). An
already-installed app would keep the old address in its baked feed, which is why there should be no installed app first
(none is published). The npm `name` stays `ootp-front-office` regardless (D-049). Also set the repository description and
topics on GitHub, which still describe the upstream product; that is outside this repository and was not touched.

## 10. Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run` | 136 files, **1764 tests** pass at the end of the first pass (baseline 133 / 1736; +3 files, +28 tests, all in the new identity, dev-port and dashboard suites) |
| `npm run build` | succeeds |
| `npm run dev` from a clean start with `PORT=5173` | web 5173, API 5178; all `/api` calls 200 through the proxy |
| Preview harness, config `pennant` | Dashboard, MLB Operations and Minor League Operations load with real data; the chips (2 and 5) match the workspaces' own counts; no console errors on a fresh load |
| Built desktop app (unsigned `electron-builder --mac --dir`, isolated data dir) | `Pennant.app`, `CFBundleName` Pennant, bundle id unchanged, version 0.1.0; launches, serves the UI (`<title>Pennant</title>`) and `/api/status` reports Pennant 0.1.0 through the Electron → server handoff |
| Bundled `package.json` in the built `app.asar` | has `name` and no `productName`, which is why `name` is held |

Not verified: an installed (as opposed to unpacked) app's auto-update against a real release, because none exists; the
keychain entry's dependence on the app name; a Windows build.

## 11. Known remaining limitations

- Brand art is raster and owner-supplied; see §5. The mark on the macOS dock is a bare triangle rather than a rounded
  square.
- No installer or tag has been published; `pennant-v0.1.0` is documented but not created.
- Prerelease versions are unsupported by the updater with `pennant-v…` tags (§12); use plain `X.Y.Z`.
- macOS signing secrets, the repository rename and the GitHub repository description are the owner's.
- `npm start` sets `NODE_ENV` with POSIX syntax and does not run in a Windows `cmd`; `npm run dev` does. Left alone
  (`NODE_ENV` is read nowhere in the code base, so it is likely removable, but that is behavior outside this phase).
- The changelog dates 0.1.0 as 2026-09-20, the day the lineage was established; no individual feature is dated.
- No screenshots are shipped: the only ones were upstream's and stale, and new ones would show a real save's data.

## 12. Owner decisions applied (2026-09-21)

The first pass held the application id and kept `v<version>` tags pending owner decisions. The owner decided:

| Decision | Applied as | Rationale |
|---|---|---|
| Application id | `com.dakotawise.pennant` in `electron-builder.yml` (was `com.lsukev.ootpfrontoffice`) | Pennant's own identity; it stops carrying upstream's author into the bundle id. Free to change now: `origin` has no releases, so no installed copy exists to split from. Must not change again once an installer is published. It is **not** what names the user-data folder, so existing data is unaffected (checked below) |
| Package author | `"author": "Dakota Wise"` in `package.json` | Replaces the placeholder "Pennant contributors" |
| Release tag | `pennant-v<package version>`, for example `pennant-v0.1.0`. `release.yml` triggers on `pennant-v*` and its guard requires `pennant-v` + `package.json`'s version; the release is titled "Pennant x.y.z"; `RELEASE_TAG_PREFIX` in `server/project.ts` drives the in-app release-notes link; `publish.tagNamePrefix: pennant-v` in `electron-builder.yml`; `CHANGELOG.md` compare links and `docs/DEVELOPMENT.md` use it | Upstream's tags are `v0.1.0` … `v0.40.1`. A `v*` convention collides with them in any clone holding the `upstream` remote's tags and would let them trigger the release workflow. The application-visible version is still `0.1.0` |
| Preserved | npm `name` `ootp-front-office`, the desktop user-data path, every `OOTP_FO_*` variable, the `data/` layout, the GitHub repository name, the git remotes | Held per D-049; no migration is attempted. Nothing was renamed from code |

**A correction.** The first pass said electron-updater "requires `v<version>` release tags", which is why a Pennant
prefix was ruled out. That was wrong. On a stable version the updater asks GitHub for `/releases/latest`, takes
`tag_name` as an opaque string for the download URL and reads the version from `latest*.yml` (read in `electron-updater`
6.8.9). D-049, DEVELOPMENT.md and this file were corrected. One real limit exists: a *prerelease* version makes the
updater require a semver-valid tag, which `pennant-v…` is not, so Pennant ships plain `X.Y.Z` versions until that is
solved.

### Assumptions searched for and their disposition

| Assumption | Where | Disposition |
|---|---|---|
| `com.lsukev.ootpfrontoffice` | `electron-builder.yml`, `tests/projectIdentity.test.ts`, DEVELOPMENT.md, D-049 | Updated. The baseline rows in §1 and §2 are history and still show the old value |
| Workflow trigger `v*`, `refs/tags/v`, `expected="v…"` | `.github/workflows/release.yml` | Updated |
| `git tag v<x.y.z>` guidance, "tags must be `v<version>`" | DEVELOPMENT.md | Updated; the false updater rationale removed |
| `/tag/v${info.version}` release-notes link | `electron/updater.ts` | Updated to `releaseTag(info.version)` |
| `compare/v0.1.0…`, `releases/tag/v0.1.0` | `CHANGELOG.md` | Updated |
| `v0.1.0` in ROADMAP §8; "held identifiers" in AGENTS.md, ARCHITECTURE, PROJECT_STATE | docs | Updated |
| `v0.1.0` … `v0.40.1`, `lsukev/ootp-front-office`, `com.lsukev.*` inside upstream material | `docs/upstream/`, README attribution, `server/project.ts` `UPSTREAM_URL`, D-049 history, this file's history rows | Kept: they are upstream's, and the attribution is required |
| `v${status.app.version}` in the header | `src/App.tsx` | Kept: a display prefix for the application version, not a tag |
| `Copyright © 2026 Kevin Ivy` in the build and `LICENSE` | `electron-builder.yml`, `LICENSE` | Kept (upstream's required notice); the built app's `Info.plist` still shows it |
| `ci.yml` | `.github/workflows/ci.yml` | No tag assumption |

### Verification of this pass

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run` | 136 files, **1773 tests** pass (1764 before this pass; +9 in `tests/projectIdentity.test.ts`) |
| `npm run build` | succeeds |
| Unsigned `electron-builder --mac --dir` | succeeds with the new appId and `publish.tagNamePrefix` (the schema accepts it) |
| Built `Info.plist` | `CFBundleIdentifier` `com.dakotawise.pennant`, name Pennant, version 0.1.0 |
| Bundled `app.asar` `package.json` | `name` `ootp-front-office`, no `productName`, `author` Dakota Wise, so Electron's userData folder is still named `ootp-front-office` (an Electron 41 probe with that `name` returned `~/Library/Application Support/ootp-front-office`) |
| Built app launched, isolated (`OOTP_FO_DATA_DIR` and `--user-data-dir` both scratch) | served the UI (`<title>Pennant</title>`); `/api/status` reports Pennant 0.1.0 |

Not verified: an installed app auto-updating (no release exists), the keychain entry's dependence on the app name versus
the bundle id, and a Windows build.

### Two things found while verifying

- **`abi:node` leaves a stale marker that makes the next `abi:electron` a silent no-op.** `@electron/rebuild` records
  `arm64--145` in `node_modules/better-sqlite3/build/Release/.forge-meta`; `npm run abi:node` (`npm rebuild`) does not
  clear it, so a following `npm run abi:electron` reports "finished" without rebuilding, and the packaged app then loads
  a Node-ABI SQLite binary and blocks at startup on an error dialog. This is why the first attempt at this pass's smoke
  test hung. CI is unaffected (a clean `npm ci` has no marker). Recovery: delete that file and rerun `abi:electron`. It is
  documented in DEVELOPMENT.md; the scripts were not changed.
- **The earlier smoke test touched the real Electron profile.** It isolated the league data (`OOTP_FO_DATA_DIR`) but not
  Chromium's own profile, so Cache, Session Storage, Local Storage and similar files were written under
  `~/Library/Application Support/ootp-front-office`. `league.db` and `history.db` were not touched (last modified
  Aug 20). This pass used `--user-data-dir` as well. The stray Chromium files are harmless and can be deleted.
