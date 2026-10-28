## SRVHEALTH report: code health across the whole repo (origin/feature/swiftui e6cdd08)

**Setup**
- Worktree: (scratch) (detached, `node_modules` symlinked from the main checkout).
- I built a synthetic league in …/scratchpad/deep/srvhealth-league and ran the sidecar headless on it.
- Nothing was committed, installed or upgraded. I didn't touch real data, OOTP files or the Keychain.
- `npm audit` and `npm outdated` reached the network and worked.

**Not re-reported:** anything already in SRVINFRA, SRVSTATS, SRVPRES, SRVVALUE, SRVAI, MACUI, MACKIT or B-NN. Extensions are marked.

---

### SRVHEALTH-01 · H · PROVEN · bug/robustness — One throw in an async route handler kills the whole server, and the Mac's Staff room can trigger it
- **Evidence:**
  - Express 4 does not catch a rejected async handler. The sidecar has no `unhandledRejection` handler (`server/sidecar.ts`, `server/index.ts`), so on Node 24 the process exits.
  - Unguarded code runs before the `try` in:
    - `server/chat.ts:1182-1196` (`/v2/staff-room/:org/ask`: `staffFor`, `personOn`, `aboutQuestionFor`, `providerCredential`);
    - `server/ai.ts:487` (`body.message?.trim()`);
    - `server/settings.ts:770` (`key?.trim()`).
  - `aboutQuestionFor` (`server/aiSurfacesService.ts:188-190`) selects `t.nickname` without checking for the column. Other modules treat that column as optional (`viewingOrganization.ts:65`).
- **Proof (sidecar on the synthetic league):**
  - `POST /api/trade/ai-reply {"message":5}` → no answer, and the process dies with `TypeError: body.message?.trim is not a function`.
  - With `teams.nickname` dropped, `POST /api/v2/staff-room/1/ask {"with":"room","about":{"playerId":1000}}` → the process dies with `SqliteError: no such column: t.nickname`.
  - The Staff room crash happens before the key check, so it needs no AI key.
  - Failing test: `tests/zz_srvhealth_asyncCrash.test.ts`.
- **Trigger:** "Ask Staff About Him" (or dragging a player in) on a save without that column, or any future throw on those lines. ServerController restarts the server, and after five crashes in two minutes it gives up for the session.
- **Fix:**
  - Wrap every async handler (an `asyncRoute` helper, or move to Express 5).
  - Add a logging `process.on('unhandledRejection')` in the sidecar.
  - Move the Staff room's pre-checks inside its `try`.
  - Column-check `nickname`.

### SRVHEALTH-02 · M · PROVEN · bug — The trade desk conversation fails with 413 once the resent thread passes 100 KB
- **Evidence:** the Mac resends the whole thread on every ask (`macos/Packages/PennantKit/Sources/PennantKit/TradesStore.swift:233-241`). The server never caps it (`server/tradeDeskService.ts:215`). `express.json()` keeps its default 100 KB limit (`server/requestBody.ts:33`).
- **Proof:** with 56 turns (~105 KB) the answer is `413 "That request is too large for Pennant to read."`. With 4 turns it reaches the handler (409, AI off).
- **Trigger:** about 28 exchanges of ~3.5 KB answers. Fewer when answers run near the 4000-token limit.
- **Fix:** cap the thread on both sides (the last N turns or characters), and give this route an explicit, stated limit. Extends SRVAI-01 (unbounded resends).

### SRVHEALTH-03 · M · PROVEN · test-gap — The farm ↔ MLB contract tests run against an empty farm and pass without asserting anything
- **Evidence:**
  - All 10 tests in `tests/farmMlbIntegration.test.ts`, plus `farmWindowedInvariants.test.ts:412`, do `if (!him) return;`.
  - `/api/farm-operations/1` in the shared fixture serves `scope.players: 0`, although the fixture has 3 AAA players in org 1.
  - Suspected cause: `affiliatePlayers` (`server/farmOperations.ts:187-198`) needs `team_roster` rows with `list_id = 2`, which the fixture doesn't carry.
- **Proof:** I turned the early returns into throws in `tests/zz_srvhealth_vac_farmMlbIntegration.test.ts` and `tests/zz_srvhealth_vac_farmWindowedInvariants.test.ts`. All 11 fail with `SRVHEALTH-VACUOUS: !him`.
  - The same check on the other early-return tests (stints, themePacks, financeViews, franchiseTool, playerSort, mlbLineupReview, scoutedEvidence, philosophyViews) shows their returns never fire.
- **Effect:** the boundary AGENTS.md calls the only join between the two operations ("joined only by the farm ↔ MLB contract") has no working test.
- **Fix:** give the fixture affiliate roster rows, and replace `if (!x) return` with `expect(x).toBeDefined()`.

### SRVHEALTH-04 · M · PROVEN · test-gap — Tests are never type-checked, and 98 type errors hide fixtures that no longer match production types
- **Evidence:** `tsconfig.json` `include` leaves out `tests` and `vitest.config.ts`. Vitest doesn't type-check. CI runs `npx tsc --noEmit` only.
- **Proof:** `npx tsc --noEmit -p zz_srvhealth_tsconfig.tests.json` reports 98 errors in 40 test files. Examples:
  - `ResponsePorts` passed where `ReviewPorts` is expected (mlbGoldenPlans, mlbGoldenAvailability, mlbReplace, mlbReview, mlbLineupReview);
  - `DataStatus['import']` built without `ourScouts` or `upgradeNote` (`dataStatusWords.test.ts:154-165`);
  - `ControlEnd` built as `{low, high}` (`rosterMap.test.ts:213`);
  - `bannedIn([...])` given arrays (`dataStatusWords.test.ts:187`, `ratingHistoryWords.test.ts:41`), which only works by string coercion.
- **Also:** server code compiles with `lib: DOM`, so browser globals type-check on the server.
- **Fix:** include `tests` (or add a `tsconfig.tests.json` run in CI), fix the errors, and drop `DOM` for `server/`.

### SRVHEALTH-05 · M · CONFIRMED (formatter PROVEN) · bug — Over budget reads "$-3.2M free"; the money formatters round $999,600 to "$1000K" and disagree with each other (extends SRVVALUE-13)
- **Negative headroom:** `server/presentation/finance/payroll.ts:102`, `:140` and `:166` pass a negative headroom to `money()`. `money()` (`server/presentation/player/words.ts:13-20`) prints `$-1.5M`. So an over-budget club reads "$-3.2M free" (red) and "$-3.2M room".
- **Rounding:** `money(999_600)` and `dollars(999_600)` both give "$1000K". The same carry bug is in:
  - `playerValueLens.ts:146`
  - `playerValueTrade.ts:134`
  - `staff.ts:179`, which also uses a lowercase "k"
  - `frontOffice/finance.ts:29`
- **Precision:** $2,345,000 reads "$2.3M" on one page and "$2.35M" on another.
- **Lens:** prints "$0" for anything under $500, so a line can read "below zero (most likely $0)" (`playerValueLens.ts:594`).
- **Proof:** `tests/zz_srvhealth_money.test.ts`.
- **Fix:** one shared formatter with carry and the sign before the "$". Payroll should say "$3.2M over".

### SRVHEALTH-06 · M · PROVEN · bug (Electron) — Reopening the window from the Dock starts a second server in the same process
- **Evidence:** `electron/main.ts:284-286`: on `activate`, `createWindow()` calls `startServer(preferred)` again. That port is already in use, so `:193-194` falls back to `startServer(0)`.
- **Effect:**
  - A second listening server, plus `bootstrapData()` run a second time (a second save-scan loop, the watcher restarted, start-up imports).
  - `port.json` is rewritten, so the next launch has a new origin and an empty localStorage — the bug `:171-177` was written to fix.
  - `shutdownServer` closes only the newer server.
- **Proof:** `tests/zz_srvhealth_electronActivate.test.ts` (two ports, both answer 200).
- **Fix:** start the server once at `whenReady`. `createWindow` should only load `serverUrl`.

### SRVHEALTH-07 · M · CONFIRMED · security/outdated — The Electron app still ships on Electron 41.10.4, which has 12 advisories
- **Evidence:** `npm audit`:
  - GHSA-vv43-5jgx-7qv8, a Squirrel.Mac update-install race, fixed in 41.10.5;
  - sandbox inheritance, CORS reads and webview-node, fixed in 41.10.6.
- **Why it matters:** a `pennant-v*` tag still releases the Electron app until the cutover (DEVELOPMENT.md).
- **Fix:** move the lockfile to 41.10.7 (inside `^41`) before any Electron release.

### SRVHEALTH-08 · M · CONFIRMED · cutover hazard — 17 "React" routes are the Mac Staff room's and AI desk's tools; this corrects the retire lists in SRVSTATS and SRVAI
- **Evidence:** `callOwnApi` (`server/chat.ts:407-506`) calls these routes, so they are Mac dependencies:
  - players, player/:id, roster/:teamId, franchise/:teamId, standings/:orgId
  - pitching/:teamId, schedule/:teamId, lineup/:teamId, payroll/:orgId, injuries/:orgId
  - prospects/:orgId, leaderboards/:orgId, teams, dashboard/:orgId, contracts/:orgId
  - free-agents/:orgId, roster-crunch/:orgId
- **Effect:** deleting "the React routes" at the cutover (SRVSTATS lists the rosterops routes; N15 plans "delete src/") would quietly break the tools. Nothing tests them as Mac dependencies.
- **Fix:** have the tools call the services directly (SRVAI's suggestion) before the cutover, or pin these routes with a test.

### SRVHEALTH-09 · L · CONFIRMED · dead-code — 10 routes no client calls (not Swift, React or the AI tools)
- `GET /api/mlb/calibration/:orgId` (`mlbOperations.ts:267`, an alias)
- `GET /api/mlb-operations/:orgId/calibration` (`:266`)
- `GET /api/player-state/:playerId` (`playerStateRoutes.ts:25`; tests only)
- `GET /api/player-value/production-fit/:orgId` (`playerValueRoutes.ts:21`)
- `GET /api/player-value?ids=` (`:31`; SRVVALUE-11)
- `GET /api/player-value/:playerId` (`:64`)
- `GET /api/club-finances/:orgId/price-history` (`clubFinanceRoutes.ts:46`)
- `GET /api/farm-operations/:orgId/arrival/:p/:t` (`farmRoutes.ts:20`; tests only)
- `GET /api/trade/roster/:teamId` (`trade.ts:535`, with no id validation)
- `GET /api/development/:orgId` (`history.ts:1897`; tests only)

### SRVHEALTH-10 · L · CONFIRMED · dead-code — The complete React-only list, to retire at cutover (no Swift caller, no AI tool)
- **Routes:**
  - briefing GET/POST; trade/voice, trade/ai-eval, trade/ai-reply
  - chat-staff; chat-history GET/PUT; POST /api/chat
  - club-finances/:orgId; next-game; export-site ×2
  - farm-operations/:orgId and /consequence; org-comparison; game-plan; tenure
  - development-history; watchlist ×4; player-notes ×3; name-index
  - mlb-operations/:orgId and /responses; models; depth-chart
  - player-value our-view, cone, surplus
  - staff; draft; scouted-development; settings/philosophy ×3; next-season-budget
  - settings/api-key POST/DELETE; storylines GET/POST
  - trade/analyze, trade/fits; search-players; trade-proposals; trade-talk; trends
- **Whole modules used only through their router:** `server/exporter.ts`, `server/farmRoutes.ts`, `server/playerValueRoutes.ts`.
- **Contract operations only Swift tests and previews use:** `getDataStatus`, `listSaves`, `getSearchLocations`, `getProviders`. `SetupModel.swift:75`'s doc comment says it fetches `/api/search-locations`, but it reads `/api/v2/saves`.
- **Keep:** `/api/logo/:teamId` and `/api/theme-packs/:id/:file`. The Mac fetches them through URLs the server sends.
- **Full table:** …/scratchpad/deep/srvhealth-out/diff.txt.

### SRVHEALTH-11 · L · CONFIRMED · dead-code — Exports and code with no production caller
- **No caller anywhere** (from `zz_srvhealth_deadexports.mjs`):
  - `aroundTheLeagueRevision`, `UNKNOWN_FORM`, `daysFrom` (frontOffice/teamSeason), `attentionComposes`, `awaitJob`, `plainReason` (mlbCalibration)
  - `expectedUsage`, `playedRegularly`, `subsetBlocks`, `ATTENTION`, `capitalized` (farm/words), `badgeTone`, `STRENGTH_WORD`
  - `fromLog`, `leaguePlatoonEffect`, `ordinal` (roleStanding), `rosterStateEventsForSave`, `rosterStateSnapshotById`, `playedWords`, `centred`, `CLUB_OWED_REFUSAL`
  - About 17 policy stamps that are built and never served: `SUPER_TWO_CALIBRATION`, `ARBITRATION_NO_CUT_CALIBRATION`, `WIN_VALUE_POLICY_CALIBRATION`, `*_FIT_STAMP`, `BULLPEN_POLICY`, `PLATOON_POLICY`, …
- **Used only by tests:**
  - `requireKnownProtection` (`developmentFit.ts:307`): the guard is tested but guards nothing.
  - `hitterStandard`, `starterStandard`, `relieverStandard` (`roleStandards.ts:192-204`): the MLB threshold and golden tests therefore test only the built-in starting values, never the per-save standards that production serves once adopted (D-053).
  - `projectProduction`, `reviewNeedFor`, `observePairs`, `freeAgentsView`, `departmentReport`, `frontOfficeSummary`, `allClear`, `itemsToDecide`.
- **Unused locals and imports:** `tsc --noUnusedLocals` finds 39 in `server/`. Examples: `scoutedEvidence.ts:410 RATING_COLUMN`; `playerValueSurplus.ts:290 declinedMayLeave` (dead, not a bug); every import at `playerValueHistory.ts:20-26`.

### SRVHEALTH-12 · L · CONFIRMED · security/outdated — npm audit: 14 advisories (3 critical, 7 high)
- **What ships (`--omit=dev`):** all three come in through express:
  - body-parser 1.20.8 (GHSA-27r3: a DoS with a compressed body; `express.json` inflates by default, but the sidecar needs the token);
  - proxy-addr 2.0.7 (not reachable: `trust proxy` isn't set);
  - qs 6.16.0 (its `stringify`, unused).
- **Development only:**
  - vite 6.4.3 (dev-server cross-origin and `fs.allow` bypass);
  - vitest / @vitest/mocker;
  - concurrently → shell-quote (critical, but called with fixed arguments);
  - undici, brace-expansion, source-map-js, http-cache-semantics, fast-uri.
- **Fix:** all of them are fixable inside the current ranges (`npm audit fix`, no major versions). Add `npm audit --omit=dev` to CI.

### SRVHEALTH-13 · L · CONFIRMED · outdated — Major versions behind, and the Node version isn't declared
- **`npm outdated`:**
  - @anthropic-ai/sdk 0.115 → 1.3.0; openai 6 → 7
  - express 4 → 5 (Express 5 forwards async rejections, which closes SRVHEALTH-01's class)
  - better-sqlite3 12 → 13; chokidar 4 → 6
  - vite 6 → 8; vitest 4 → 5
  - electron 41 → 45; typescript 5.9 → 7
- **Node version:** `@types/node ^22`, while the sidecar pins Node 24.21.0. There's no `engines` field, and README:119 still says "Node.js 20 or newer" (SRVINFRA-10).
- **Fix:** `engines: node >=24` and `@types/node ^24`. Plan the SDK major versions after the cutover.

### SRVHEALTH-14 · L · CONFIRMED · test-gap — Contract fixtures are golden files that get rewritten wholesale
- **Evidence:** 176 fixtures are compared byte for byte (`tests/contract.test.ts:296-304`). `CONTRACT_FIXTURES=write` rewrites all of them, so any wrong output becomes the expected value that Swift decodes. That is how SRVPRES-06's jargon got in.
- My scan for NaN, undefined, "$-" and "$1000K" in the current fixtures came back clean.
- **Fix:** semantic checks on every fixture string: money format and the banned-jargon list on all fields.

### SRVHEALTH-15 · L · CONFIRMED · hygiene — .gitignore misses four of the six worker bundles that `desktop:build` writes into build/
- **Evidence:** `import-worker`, `snapshot-worker`, `front-office-worker` and `transaction-log-worker` (`.cjs` and `.map`) are not ignored (`git check-ignore`). `scripts/build-desktop.mjs:25` writes them.
- **Fix:** ignore `build/*.cjs` and `build/*.cjs.map`.

### SRVHEALTH-16 · L · CONFIRMED · security (Electron, defence in depth)
- IPC handlers never check the sender frame (`electron/main.ts:257-278`, `electron/updater.ts:136-179`).
- `will-navigate` allows any port on `localhost` or `127.0.0.1` (`main.ts:128`), keeping the preload bridge.
- `open-path` checks the path's prefix without `realpath`, so a symlink inside the data folder can open anything (`main.ts:274-277`).
- Note: `contextIsolation` is true, `nodeIntegration` is false, there is no `innerHTML`, and external links are restricted to http(s).

### SRVHEALTH-17 · L · CONFIRMED · outdated/safety — Scripts
- `scripts/rights-experiment.ts` and its `rights:*` npm scripts exist for owner-run OOTP experiments, which AGENTS.md now forbids. Retire them.
- `scripts/bench-import.mjs` has none of the forbidden-folder guard in `bench-launch.mjs:37`, so it can import into `data/` or the real data folder.

### SRVHEALTH-18 · L · CONFIRMED · test-gap — Route tests don't run production's middleware chain
- **Evidence:** `tests/request.ts:15` mounts `express.json()`, not `readJsonBodies`, and no host or token checks.
- **Effect:** body errors, 413s and the token path are never exercised by route tests. That is why SRVHEALTH-01 and -02 weren't caught.
- **Note:** 183 assertions in the suite are only `toBeDefined`, `toBeTruthy` or `not.toBeNull`.

### SRVHEALTH-19 · L · CONFIRMED · duplication — Small helpers copied many times
- 9 `ordinal` copies; `playerRights.ts:1535` and `playoffs.ts:216` say "21th" past ten.
- 13 `plural` copies and about 10 `pct` copies, which mostly agree.
- Fold these into one words module together with the money formatter (SRVHEALTH-05).

### SRVHEALTH-20 · L · environment note — The main checkout's node_modules is out of date
- `ajv-formats` and `ts-json-schema-generator` are missing although the lockfile has them.
- So in the main checkout `npx tsc --noEmit` fails (`scripts/lib/contractSpec.ts:22`) and `tests/contract.test.ts` can't load.
- It needs `npm ci`, which I didn't run, per the rules.

**Checked and clean:**
- No secret or key reaches the logs. The sidecar log rotates.
- Background `void` promises all catch their errors. Every worker has an `'error'` handler.
- Token comparison is constant-time. SSE heartbeats are cleaned up. Theme-pack and logo file serving is allow-listed.
- No OOTP-file write in scripts or Electron.
- Fixture dates are unpadded, as in real exports.

---

### The three riskiest areas
1. **Request-handler hygiene.** Async handlers on Express 4 with no process-level net (SRVHEALTH-01), default body limits (SRVHEALTH-02), and route tests that bypass the production middleware (SRVHEALTH-18). Wanted: one `asyncRoute` wrapper, Express 5, and a test that sends malformed and oversized bodies to every POST/PUT route through `readJsonBodies` and asserts a 4xx and a live process.
2. **Tests that look green but check little.** Vacuous early returns on an empty fixture farm (SRVHEALTH-03), untype-checked tests with drifted fixture shapes (SRVHEALTH-04), golden files rewritten wholesale (SRVHEALTH-14), and threshold tests on the starting values only (SRVHEALTH-11). Wanted: type-checked tests, a fixture with a real farm, and invariant checks on fixtures.
3. **The cutover's blast radius.** The AI tools depend on "React" routes through HTTP (SRVHEALTH-08), React-only modules and routes are still mounted in the sidecar (SRVHEALTH-09 and -10), and Electron is still released on a vulnerable version (SRVHEALTH-06 and -07). The cutover PR needs an explicit keep/delete list, which SRVHEALTH-08 to -10 provide.

### Upstream-era code to retire or rewrite
- **`callOwnApi` and the HTTP-calling chat tools** (`server/chat.ts:122-506`). Rewrite them to call services directly. That is the only thing keeping 17 React routes alive after the cutover.
- **`exporter.ts`, `farmRoutes.ts`, `playerValueRoutes.ts` and the 10 no-client routes.** Retire them now. None has a current caller.
- **`electron/` and the token-less server mode.** Retire them at the cutover, as planned. Until then, fix SRVHEALTH-06 and bump Electron.
- **The copied formatters.** Replace them with one shared words module (money, ordinal, plural, pct).
- **`scripts/rights-experiment.ts` and its `rights:*` npm scripts.** Retire; they conflict with the no-owner-experiments rule.

### Proving tests and tools (in the worktree)
- …/wt-srvhealth/tests/zz_srvhealth_asyncCrash.test.ts — fails today (SRVHEALTH-01).
- …/wt-srvhealth/tests/zz_srvhealth_vac_farmMlbIntegration.test.ts and …/wt-srvhealth/tests/zz_srvhealth_vac_farmWindowedInvariants.test.ts — 11 failures (SRVHEALTH-03).
- …/wt-srvhealth/tests/zz_srvhealth_electronActivate.test.ts — passes; it shows the bug (SRVHEALTH-06).
- …/wt-srvhealth/tests/zz_srvhealth_money.test.ts — passes; it shows the bug (SRVHEALTH-05).
- …/wt-srvhealth/zz_srvhealth_tsconfig.tests.json (SRVHEALTH-04).
- …/wt-srvhealth/zz_srvhealth_deadexports.mjs, zz_srvhealth_routeonly.mjs and zz_srvhealth_noassert.mjs (the analysis tools).
- Outputs (routes, the contract diff, audit, outdated, tsc errors): (scratch)

Here `…` is (scratch)

The sidecar runs I started have all exited, and the synthetic league's `league.db` is back to its original state.
