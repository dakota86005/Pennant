# SRVINFRA code review: import, data and the API

Reviewer slice: `server/importer.ts`, `importWorker.ts`, `importBuild.ts`, `importCache.ts`, `importSnapshots.ts`,
`postImport.ts`, `db.ts`, `exporter.ts`, `exportFiles.ts`, `dataFreshness.ts`, `dataLock.ts`, `dataStatus.ts`,
`saveDiscovery.ts`, `saveIdentity.ts`, `ootpSave.ts`, `liveLogSnapshot.ts`, `transactionLog*.ts`,
`transactionHistory.ts`, `watcher.ts`, `paths.ts`, `jobs.ts`, `startupWork.ts`, the `*Worker.ts` files, `config.ts`,
`settings.ts`, `sidecar.ts`, `index.ts`, `api.ts`, `apiToken.ts`, `requestBody.ts`, `serverEvents.ts`, `health.ts`,
`themePackStore.ts`, `logos.ts`, `appInfo.ts`, `project.ts`, plus the callers needed to prove a trace.

Checked out at `feature/swiftui-n15-polish` (8be36b1). Nothing in B-01..B-56 is re-reported. Where a finding goes
further than a B item, it says `extends B-NN`.

## How this was verified

- `npm ci`, then throwaway Vitest files under `tests/zz_review_*.test.ts`, run one at a time with
  `npx vitest run tests/<file>`. They are pasted below each finding. They were not committed.
- The production sidecar bundle (`npm run build:sidecar`, `build/sidecar/server.cjs`) was run headless on Node 24.21.0,
  which is what the Mac app ships (`scripts/fetch-node-runtime.mjs`). Node 24 came from `npx node@24`, and
  better-sqlite3 was rebuilt for its ABI in a scratch folder. The bundle was driven with a token on stdin and with curl
  against a synthetic league (`npm run synthetic:league`). The tsx sidecar (`npx tsx server/sidecar.ts`) and the
  token-less dev server (`PORT=47811 npx tsx server/index.ts`) were also run on the VM's Node 22.22.0.
- The synthetic generator only writes the active players' tenure, so "long history" stays a small league whatever
  `historySeasons` says. Import scale and memory are therefore judged from the code, not measured (SRVINFRA-32).
- Severity: H = wrong answer, data loss, crash, hang, doctrine or security breach. M = wrong in edge cases, a real
  performance or robustness problem, or significant outdated code. L = a smell with a concrete risk. Confidence:
  PROVEN (a command shows it), CONFIRMED (traced in code), SUSPECTED.

## Findings, most severe first

### SRVINFRA-01 · H · PROVEN · doctrine — After choosing another save, the served league's players get the other save's transactions, dates and identity

- **Evidence:** `server/api.ts:822-834`. `chooseSave` writes the new save into `config.json` first, and returns early,
  leaving it chosen, when its export folder isn't there (`:851`, "chosen all the same"). `server/dataStatus.ts:171-183`
  locates the save from `loadConfig()` (key `configStamp|generation`), not from the import being served. Every
  chronology reader goes through it: `server/playerContext.ts:97,127,141` (`rightsFor`, `assignmentContextsFor`,
  `playerPicture`), the freshness inputs (`dataStatus.ts:411-429`: the save's `last_date_simulated.dat` and live log)
  and `server/history.ts:420` (`currentSaveName()` is the config's name). That name keys `saveIdentity`
  (`saveIdentity.ts:276-283`), and through it every per-save fit and market store (D-053). `frontOfficeImportKey`
  (`frontOfficeService.ts:288`) also keys on `config.json`'s stat, so every department rebuilds at once on the mixed
  inputs.
- **What the codebase already knows:** `historyIdentity.ts:205-212` (`servedLeagueCertain`) and
  `saveDiscovery.ts:251-256` already treat a configured save and the served league as two different things, but only
  for `saveId`.
- **Trace:** Save B is chosen. The database is still save A's. OOTP numbers players with small integers in every league, so
  ids recur across saves and `log.byPlayer.get(id)` hands A's player B's events. `assignmentContextFor` and `evaluatePlayerRights` then read them
  as his chronology (D-020, D-021, D-023). Freshness compares A's export date with B's save date ("Stale — 10 days
  behind"), and a stale export turns every right indeterminate.
- **Trigger:** Any switch. It is transient during the new save's import (quiet period plus build), and lasts until a
  successful import when the new save has no export yet or its import fails or is refused. The watcher is not
  re-armed for a save whose folder is missing (`api.ts:834` returns before `:840`); the old watcher ignores the old
  folder, so B's export is not noticed until the GM chooses B again or relaunches.
- **Proof, shipped bundle on Node 24:** after `POST /api/config` for a save `Other.lg` whose `temp/text_data.sqlite3`
  holds "Optioned SS <player_1000> Someone Else to Triple A Reno" (the answer was `importStarted:false`),
  `GET /api/player-state/1000` returned
  `chronology: [["optioned","Someone Else","Optioned SS Someone Else to Triple A Reno."]]`, and `GET /api/data-status`
  returned `save: Other … freshness "Stale — league snapshot 10 days behind"`.
- **Proof, Vitest:**

```ts
// tests/zz_review_switch_log.test.ts — passes
import { afterAll, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { loadConfig, saveConfig } from '../server/config.js';
import { resetTransactionLogCache } from '../server/dataStatus.js';
import { playerPicture } from '../server/playerContext.js';
import { makeSave, tx } from './liveLogFixture.js';
const before = loadConfig();
const other = makeSave({ name: 'Another Save', simulated: [2030, 5, 31], rows: [] });
afterAll(() => { saveConfig(before); resetTransactionLogCache(); other.cleanup(); });
it("the served league's players get the other save's transactions", () => {
  const p = db.prepare("SELECT player_id AS id FROM players ORDER BY player_id LIMIT 1").get() as { id: number };
  other.add([{ date: '20300520', text: tx.optioned([p.id, 'Someone Else'], 'SS', [99, 'Reno']) }]);
  saveConfig({ csvDir: other.csvDir, saveName: 'Another Save' }); // what chooseSave does first
  resetTransactionLogCache();
  const picture = playerPicture(p.id)!;
  expect(picture.chronology.map((e) => [e.kind, e.playerName])).toEqual([['optioned', 'Someone Else']]);
});
```

- **Fix:** Every served-data reader (the save's place, its log, its date, its name) should derive the save from the
  served import's record (`importRecord().csvDir`), never from `config.json`. While the configured save differs from
  the served one, report the log as unavailable ("not the served save"). Related to B-07, but this one is the server,
  not the Swift stores.

### SRVINFRA-02 · H · PROVEN · bug — Any failure after the rename reports the import as failed while the new database is already served

- **Evidence:** `server/importer.ts:309-318`. The swap renames, then runs `then()` in the same call: the
  `writeFileSync(LAST_IMPORT_PATH)` (not atomic), then `afterSwap`. Any throw in `then()` comes out of `swapWhenFree`
  (`db.ts:196-207`) after `generation += 1` (`db.ts:182-183`).
- **What `runImport` then does** (`api.ts:402-416`): it sets `lastError` and `lastFailed`, keeps the marker, and skips
  the post-import hooks (snapshots, refits, Front Office warm-up, `remember`). Because `afterSwap` never ran, the
  following are stale:
  - `importState.lastImport` and `importedAt` keep the old import's values.
  - `clearLeagueCaches` never runs, so stats baselines, results populations, Player Value, the save identity, scales
    and the two-way cache all stay as computed from the old file.
  - Every department cache keyed on `importedAt` (`frontOfficeImportKey`, `frontOfficeService.ts:288`) keeps serving
    the previous import's payloads.
  - `importRecord()` now distrusts the new file (`db.ts:343`: start time ≠ `last-import.json`), so the rating mode
    reads unknown and the next import carries no stale tables.
- **Windows (Electron) variant:** a `then()` failing with `EPERM` (antivirus) is treated as "held" and retried, and the
  retry renames a file that is gone (`ENOENT`).
- **Trigger:** `last-import.json` can't be written (disk full; the 4.5× room check covers the build, not this write;
  permissions), or `afterSwap` throws: `importLandedForClub` → `followSaveClub` → `writeSettings` (`settings.ts:208-241`)
  on a full disk.
- **Proof:**

```ts
// tests/zz_review_swap.test.ts — passes
it('a failure after the swap reports the import failed while the new database is already served', async () => {
  write(1); await importCsvDir(dir);
  const before = databaseGeneration();
  fs.rmSync(LAST_IMPORT_PATH, { force: true }); fs.mkdirSync(LAST_IMPORT_PATH); // stands in for ENOSPC/EPERM
  write(2);
  let afterSwapRan = false;
  await expect(importCsvDir(dir, { afterSwap: () => { afterSwapRan = true; } })).rejects.toThrow(/EISDIR|illegal operation/);
  expect(databaseGeneration()).toBe(before + 1);
  expect((db.prepare('SELECT version FROM players').get() as { version: number }).version).toBe(2);
  expect(afterSwapRan).toBe(false);
});
```

- **Fix:** Write `last-import.json` to a temporary file before the rename and rename it into place right after. Run
  `afterSwap` in a try/catch. Once the league file is renamed, report the import as succeeded (with a warning)
  whatever fails after it.

### SRVINFRA-03 · H · PROVEN · bug — One torn settings.json silently resets, and the next save of anything erases every philosophy, budget, theme and club choice

- **Evidence:** `server/settings.ts:196-202`. `loadSettings` catches every parse error and returns the defaults.
  `writeSettings` (`:239-241`) and `writeKeyFile` (`:362-364`) overwrite the file in place, not atomically, and every
  writer reads, merges and writes the whole object (`savePhilosophyForOrg :267-274`, `setNextSeasonBudget :584-593`,
  `saveThemePackChoice :247-255`, `POST /settings :637-724`, `followSaveClub :208-211`). `config.ts:63-72`/`:89-91`
  has the same pattern: a torn `config.json` reads as "no save chosen" (`configured: false`), and the app falls back
  to first-run setup, where `POST /api/v2/setup/automatic` may pick a save again.
- **The fix already exists in the codebase:** it is applied to `clubOwed.ts:73-79`, `servedFacts.ts:76-79` and
  `chat.ts:84-86` (N13 review L8: "kept aside so the page's next save can't wipe it"), but not to the three files the
  GM cares most about.
- **Trigger:** A crash, power loss or full disk during a write, or a hand edit with a stray comma.
- **Proof:**

```ts
// tests/zz_review_settings.test.ts — passes
saveThemePackChoice(1, 'navy');
const good = fs.readFileSync(SETTINGS, 'utf8');
fs.writeFileSync(SETTINGS, good.slice(0, Math.floor(good.length / 2)));   // a write cut short
expect(loadSettings().themePacks).toEqual({});                              // read as defaults, no error
saveThemePackChoice(2, 'red');                                              // one unrelated change...
expect(JSON.parse(fs.readFileSync(SETTINGS, 'utf8')).themePacks).toEqual({ '2': 'red' }); // ...and the rest is gone
```

- **Fix:** Write via a temporary file, fsync and rename for `settings.json`, `config.json` and `credentials.json`. When
  a file won't parse, keep it aside (as `chat.ts` does) and refuse to write over it until it is repaired or the GM
  confirms.

### SRVINFRA-04 · H · PROVEN · bug — Choosing a new save "forgets the old club / asks which club" only in memory: after a relaunch the new save follows another league's team id as if chosen

- **Evidence:** `server/settings.ts:219-237` (`let clubForgottenOnImport`) and `server/clubOwed.ts:37,61-63`
  (`let owedOnImport`) are module variables. `clubFromSave` (`api.ts:897-926`) sets them, and `afterSwap` consumes them
  (`api.ts:390-392`). `viewingOrganization.ts:13-18` takes a configured id as configured even when it belongs to
  another league.
- **Trigger:** The GM chooses a save that has no export yet (accepted, `importStarted:false`), quits Pennant, exports
  from OOTP and relaunches. A crash or quit during the new save's import does the same. This is the realistic path for
  the H1 bug the N6 review fixed within one process.
- **Proof, shipped bundle on Node 24, two launches:**
  - Run 1: import save A, `POST /api/settings {defaultOrgId: 3}`, then
    `POST /api/config {csvDir: B (no export), club:"fromSave"}` → "The export doesn't say which club you manage, so
    Pennant will ask". Stop.
  - Write B's export, with B's human club = 2.
  - Run 2: B's export is imported at start. `GET /api/settings` → `organization: {"id":3,"source":"configured"}`,
    `clubOwed: null`. Pennant follows B's club 3 as if the GM chose it, and nothing asks.
- **Fix:** Persist the pending intents beside the configuration, atomically. Better, record the club choice with the
  save it was made in (save id) and treat a `defaultOrgId` recorded for another save as not chosen.

### SRVINFRA-05 · H · PROVEN · bug — The batted-ball league baselines are computed once per process and never cleared: every later import, a save switch, or day one keeps the first league's numbers

- **Evidence:** `server/battedball.ts:63,82-108` (`bucketCache`, per level) and `:232-259` (`leagueCache`).
  `clearBattedBallCache` (`:111-114`) is never called anywhere in the server, and `clearLeagueCaches`
  (`api.ts:329-342`) leaves it out. It feeds `contactProfiles` and `contactLeague`: `player.ts`, `roster.ts`,
  `trade.ts`, `gameplan.ts`.
- **Trigger:**
  - A second import in one server session.
  - A switch to another save, whose expected-contact numbers are then judged against the first save's league.
  - Day one of a save: a level's empty bucket map is cached, so expected stats stay empty for that level until
    relaunch.
- **Proof:**

```ts
// tests/zz_review_battedball.test.ts — passes
write(90); await runImport(dir); expect(contactLeague()?.avgExitVelo).toBe(90);
write(100); await runImport(dir);
expect((db.prepare('SELECT AVG(exit_velo) AS v FROM players_at_bat_batting_stats').get() as { v: number }).v).toBe(100);
expect(contactLeague()?.avgExitVelo).toBe(90); // still the first import's league
```

- **Fix:** Use `importCache` for both (keyed on the database generation), or call `clearBattedBallCache()` in
  `clearLeagueCaches`. Add a test that lists every module-level cache and asserts it is either generation-keyed or
  cleared at the swap.

### SRVINFRA-06 · H · PROVEN · bug — An export with an empty or missing players, teams or leagues file replaces a good league with one that has none

- **Evidence:** `server/importWorker.ts:509-524`. A file with no header row makes no table, and it is not counted as
  unreadable, so the `required` check (`:500`) never fires. `importer.ts:208-211` refuses only a *stale* required
  file (`exportFiles.ts:48-49,170-174`), and nothing checks that the required tables exist or have rows. The suite
  relies on this: `tests/importCache.test.ts:16-21` imports a players-only export.
- **Trigger:** OOTP stops mid-export (crash, full disk) and leaves `players.csv` at 0 bytes or header-only, or the GM
  points Pennant at a folder without the core files. The previous good import is then replaced; `hasData` turns false
  and every page empties.
- **Proof:**

```ts
// tests/zz_review_empty_required.test.ts — passes
await importCsvDir(dir); expect(tableExists('players')).toBe(true);
/* rewrite leagues.csv and teams.csv, and leave players.csv at 0 bytes */
const result = await importCsvDir(dir);
expect(result.leftOut).toEqual([]);
expect(tableExists('players')).toBe(false);
```

- **Fix:** After the build, refuse (an `ImportRefused` with a new code) when any `REQUIRED_TABLES` table is absent or
  has zero rows, and keep the previous import.

### SRVINFRA-07 · H · PROVEN · security — On the token-less servers (Electron, `npm run dev` / `npm start`) any web page can start AI generations, imports and site exports

- **Evidence:** `server/index.ts:38,77-96`. The defence is the Host header, which a cross-site request to
  `http://localhost:<port>` passes. `apiToken.ts:189-190` does nothing without a token, and only the sidecar sets one.
  `express.json()` ignores a `text/plain` body, so every POST route that needs no body works as a "simple"
  cross-origin request (no preflight):
  - `POST /api/briefing/:orgId` (`ai.ts:189`) and `/api/v2/briefing/:org` (`ai.ts:536`)
  - `POST /api/storylines/:orgId` (`storylines.ts:357`) and `/api/v2/storylines/:org` (`:397`)
  - `POST /api/import` (`api.ts:946`)
  - `POST /api/v2/setup/automatic` (`api.ts:792`)
  - `POST /api/export-site/:orgId` (`exporter.ts:224`), which runs `rmSync` and then a full crawl
  
  `0.0.0.0` is also allowed as a Host (`index.ts:38`). The comment at `index.ts:27-31` names "spend the user's API
  credits" as the threat it guards against.
- **Proof:** the dev server with `{"provider":"ollama"}` in `settings.json`:

```
$ curl -s -X POST -H 'Origin: https://evil.example' -H 'Content-Type: text/plain' --data x http://127.0.0.1:47811/api/briefing/1
{"started":true,"job":{"state":"running",...}}
$ curl -s -X POST -H 'Origin: https://evil.example' -H 'Content-Type: text/plain' --data x http://127.0.0.1:47811/api/storylines/1
{"started":true,"job":{"state":"running",...}}
```

  With a cloud key, each of these is a paid generation, and a page can repeat them every time the last job finishes.
- **Fix:** Refuse any non-GET request whose `Origin` (or `Sec-Fetch-Site`) is not the server's own origin, or require a
  custom header such as `X-Pennant: 1`, which forces a preflight the server never grants. Give the Electron build a
  per-launch token too.

### SRVINFRA-08 · M · CONFIRMED · bug — The GM's inputs are keyed by bare team id across saves: club 3's philosophy, next-season budget and theme apply to club 3 of every save

- **Evidence:** `server/settings.ts:110-122`. `organizationPhilosophies`, `nextSeasonBudget` and `themePacks` are
  keyed by `String(teamId)`, and the doc comment even claims "different clubs and saves may think differently".
  Readers: `philosophyForOrg :257-261` (used by `mlbOperations.ts:41,61`, `farmOperations.ts:758`, `org.ts:453`,
  `contracts.ts:433`, `playerDossierBuild.ts:64`, `trade.ts:218`), `setNextSeasonBudget :584-593` (Finance headroom)
  and `chosenPack` (`themePackStore.ts:118-121`).
- **Trigger:** A GM with two saves. OOTP numbers clubs from 1 in every league. Save B's club 3 is then ordered by save
  A's club 3's philosophy (assignmentPreference, the Player Value lens), and its future payroll room uses A's budget
  guess, with nothing on screen saying so.
- **Fix:** Key these by the served save's id (D-063) plus team id. Migrate the existing entries to the save in force at
  the first start.

### SRVINFRA-09 · M · CONFIRMED · bug — Briefing, storylines and Staff room conversations are keyed by team id only, so another save's are shown, and sent to the model

- **Evidence:** `server/aiSurfacesService.ts:41-45` writes `chat-<org>.json`, `chat-context-<org>.json`,
  `storylines-<org>.json` and `briefing-<org>.json` in the data folder. `briefingNow` (`:298-313`) and the
  storylines reader serve them for whatever save is imported. The only caution, "Written from a different export"
  (`presentation/ai/writing.ts:58-69`), appears only when the two game dates differ, and two fresh saves both start
  on OOTP's default opening day. The Staff room sends the kept conversation and context to the provider as history.
- **Trigger:** Switching between two saves on the same game date (two new leagues, or a league copied to try
  something), then opening the same team id.
- **Fix:** Key the files by save id. `extends B-07` (that item covers the Swift stores; this is the server's data
  folder).

### SRVINFRA-10 · M · PROVEN · outdated — From source on Node 20 or 22 (the README says "Node.js 20 or newer"), no worker except the import's can load

- **Evidence:**
  - `frontOfficeService.ts:187-193` and `dataStatus.ts:232-235` assume a worker given `.ts` sources can load "under
    tsx". On Node 22.22 the worker gets no tsx resolve hook: `Cannot find module '/…/server/frontOfficeBuild.js'
    imported from …/frontOfficeWorker.ts`. The same happens to `playerValueRefitWorker.ts`,
    `calibrationRefitWorker.ts` and `snapshotWorker.ts`.
  - Effects: the Front Office falls back in-process for the rest of the session, the snapshots run on the server's
    thread, and `api.ts:280-283` skips the per-save calibration refit outright: "the refit is skipped and the fits in
    force stay". D-053 never refits under `npm run dev` on Node 22.
  - `README.md:119` says Node 20+. `package.json` has no `engines` field. CI uses 24 (`.github/workflows/ci.yml:34`),
    which hides it.
- **Proof:**
  - `npx vitest run tests/sidecarProcess.test.ts` on Node 22.22.0: `× builds the Front Office in its worker thread …`
    (`expected … not to contain 'worker unavailable'`).
  - A 3-file repro (`main.ts` spawns `w.ts`, which imports `./a.js`): `worker error Cannot find module …/a.js` on Node
    22, `worker ok 1` on Node 24.21.0.
- **Fix:** Declare `"engines": {"node": ">=24"}` and add `.nvmrc`, and correct the README. Alternatively spawn the
  source workers with an explicit `execArgv: ['--import', 'tsx']`. In both cases, report a load failure as such.

### SRVINFRA-11 · M · CONFIRMED · bug — One failed worker job switches every later build of every department onto the server's thread for good

- **Evidence:** `server/frontOfficeService.ts:236-249` (`run`) and `:262-272` (`runDepartmentJob`) set
  `workerBroken = true` on *any* rejection. That includes a build's own error, which `frontOfficeWorker.ts:122-124`
  posts as `{ok:false}`, and a worker that ran out of memory. Nothing resets the flag. The in-process build then
  throws the same error, so the request fails anyway, and from then on the Morning Report, every department view and
  every decision are built on the event loop. Builds take 0.6 to 1.3 s each on the 4-club synthetic league, and the
  N6 notes speak of minutes on an unindexed large league. The status, SSE heartbeats and every other request wait
  behind them.
- **Trigger:** One data-dependent throw in any department build, for example an export variant that gives
  `no such column`.
- **Fix:** Mark the workers broken only on a spawn or load failure (`ERR_MODULE_NOT_FOUND`, a worker `error` before
  its first message). Treat a posted `{ok:false}` as that job's failure.

### SRVINFRA-12 · M · PROVEN · bug — The save's identity, the key of every per-save fit, market and contract snapshot, moves when the league's data moves

- **Evidence:** `server/saveIdentity.ts:245-283`. The identity is `currentSaveName()` (the configured display name,
  `history.ts:420`) plus a hash of the league's name, its first season with major-league lines, and the first 64
  players of that season with their birth dates. Consumers: `saveCalibrationStore.ts`, `playerValueFitStore.ts`,
  `playerValueContractStore.ts`, `playerValueSnapshot.ts`, `mlbCalibrationRefit.ts`.
- **Trigger:**
  - The league is renamed in OOTP.
  - A retired player of the first season drops out of `players.csv` (shown below). Whether OOTP's database upkeep
    removes old retired players is SUSPECTED.
  - Day one of a save: there are no lines, so the identity changes when the first season's lines appear.
  - The save is chosen under a different name.
  
  In each case the D-053 fits and the accumulated market and contract history are orphaned, and the save is treated
  as new.
- **Proof:**

```ts
// tests/zz_review_identity.test.ts — passes (on buildSave({season:2040, historySeasons:3, ...}))
clearSaveIdentityCache(); const before = saveIdentity(league);
db.prepare('DELETE FROM players WHERE player_id = ?').run(oneOfTheFirstSeasonsPlayers);
clearSaveIdentityCache(); expect(saveIdentity(league)).not.toBe(before);
```

- **Fix:** Build the identity from something stable: the save's folder id (D-063, `saveId`) plus the league id. Use
  the fingerprint only to detect "a different league in this folder".

### SRVINFRA-13 · M · PROVEN · bug — Windows-1252 exports are decoded as Latin-1, so Š, š, Ž, ž, Œ, œ, Ÿ, ’, – and € in names become control characters, while the live log decodes the same bytes correctly

- **Evidence:** `server/importWorker.ts:142-149`: a file that is not valid UTF-8 is parsed as `'latin1'` (ISO-8859-1),
  which maps 0x80-0x9F to C1 controls. `saveDiscovery.ts:455-457` does the same. `transactionLog.ts:279-294` uses
  `TextDecoder('windows-1252')`, which decodes correctly on Node 24 (`Šš€á`) and, notably, gives the same wrong
  answer as Latin-1 on Node 22. A player's name therefore differs between the export and the log (the log's sentences
  name him one way, the export's rows another), and a folded search for "Simon" won't find "\u008aimon".
- **Proof:**

```ts
// tests/zz_review_encoding.test.ts — passes
const bytes = Buffer.concat([Buffer.from('player_id,team_id,first_name,last_name\n1,1,'), Buffer.from([0x8a]),
  Buffer.from('imon,'), Buffer.from([0x8e, 0xe1]), Buffer.from('k\n')]);   // "Šimon Žák" in Windows-1252
fs.writeFileSync(path.join(dir, 'players.csv'), bytes); await importCsvDir(dir);
expect(row.first_name).toBe('\u008aimon'); expect(row.last_name).toBe('\u008eák');
```

  Also: `node -e "console.log(new TextDecoder('windows-1252').decode(new Uint8Array([0x8a])))"` prints `Š` on
  v24.21.0 and `\u008a` on v22.22.0.
- **Fix:** Decode the fallback as Windows-1252 (`TextDecoder` on Node ≥ 24, or a 32-entry table for 0x80-0x9F) before
  the parser, in both places. Pin Node ≥ 24 (SRVINFRA-10).

### SRVINFRA-14 · M · PROVEN · bug — An export whose files carry a future time is never imported, and Import Now blames OOTP

- **Evidence:** `server/exportFiles.ts:153-155` computes `quietForMs = max(0, now − newest)`, so a future mtime is
  "written 0 ms ago" until the clock catches up. The watcher re-arms every 10 s and never calls the handler
  (`watcher.ts:80-84`). `importer.ts:177-190` waits the full 200 s, then refuses with "OOTP was still writing the
  export". `saveDiscovery.ts:43-53` already treats a future file time as unknown; this module doesn't.
- **Trigger:** An exFAT or FAT external drive (local-time stamps) moved across time zones, a network share with a skewed
  clock, or an export copied from a machine whose clock is ahead.
- **Proof:**

```ts
// tests/zz_review_future_mtime.test.ts — passes
const files = ['players.csv', 'teams.csv', 'leagues.csv'].map((file) => ({ file, table: file.replace('.csv', ''), size: 10, mtimeMs: now + 3_600_000 }));
for (const later of [0, 60_000, 1_800_000]) {
  const a = assessFiles(files, now + later);
  expect(a.settled).toBe(false); expect(a.settlesInMs).toBe(10_000);
}
```

- **Fix:** Treat an mtime more than a tolerance ahead of now as unknown, and settle on an unchanged folder fingerprint
  across two looks one quiet period apart. The refusal should say the file times are in the future.

### SRVINFRA-15 · M · CONFIRMED · bug — An import can hang forever and nothing can stop it short of relaunching

- **Evidence:** `server/importBuild.ts:98-122` sets no timeout on the build worker. The parse workers do blocking
  whole-file reads (`importWorker.ts:108-140`). Only the settle phase has a limit (`importer.ts:177-190`). While
  `importState.importing` is true, `POST /api/import` and `POST /api/config` answer 409 (`api.ts:847,949`), and the
  watcher only sets `lookAgainAfterImport`. There is no cancel route.
- **Trigger:** The supported OneDrive-synced saves location (`paths.ts:74`) with an online-only file while offline, a
  stalled SMB or NFS share, or a parser stuck on a pathological file. The GM can't switch saves or import until they
  quit Pennant.
- **Fix:** Add a watchdog that terminates the build worker after a generous limit and refuses with a clear reason, and
  a `POST /api/import/cancel` that does the same.

### SRVINFRA-16 · M · CONFIRMED · bug — The data-folder lock trusts a process id across reboots, and two simultaneous starts can both take a stale lock

- **Evidence:** `server/dataLock.ts:38-46,61-88`. A lock whose pid belongs to *any* live process is held. After a crash
  or force quit followed by a reboot, macOS hands low pids out again, so a daemon can own the old pid. The app then
  refuses to start ("Another copy of Pennant is using this data folder … delete …/server.lock"), and the Mac app
  shows `locked` without retrying.
- **The race:** in the takeover, process A clears the stale file and writes its own lock. Process B, which also read
  it as stale, then removes A's fresh lock with `rmSync` (`:83`) and writes its own. Both believe they hold it, which
  is the D-055 corruption case the lock exists for. It needs a near-simultaneous start, for example the Mac app and
  Electron both opening at login.
- **Fix:** Treat a lock written before the last boot (`Date.now() − os.uptime()·1000`) as stale. Take it over by
  writing a temporary file and renaming it with a compare: re-read the lock after the rename and back off if it isn't
  yours.

### SRVINFRA-17 · M · CONFIRMED · bug — A failed (not refused) import keeps the "interrupted" marker, so every launch re-runs the same failing import and calls it interrupted

- **Evidence:** `server/api.ts:402-411` removes the marker only for an `ImportRefused`. A `BuildError` (a corrupt
  required file, a row-count mismatch) or a post-swap failure (SRVINFRA-02) keeps it. At start,
  `recoverInterruptedImport` (`:164-176`) sets `interruptedSince` and imports again. While it runs, the note says "The
  last import stopped before it finished…" (`presentation/importWords.ts:110-117`), which is false: it failed.
  `lastFailed` lives only in memory, so each launch pays a full build (tens of seconds on a large league) for the same
  broken export.
- **Fix:** Write the failure into the marker (its export fingerprint) and recover only an import that was genuinely
  cut off, or one whose export has changed since.

### SRVINFRA-18 · M · CONFIRMED · perf — The live log is still copied, checked and parsed on the server's thread on request paths, sometimes twice at once

- **Evidence:**
  - `server/dataStatus.ts:302-332`: `currentTransactionLog` calls `readHere` (copy, `quick_check`, parse) synchronously
    whenever no copy of this save is cached. It never looks at `reading`, so a request that arrives while the start-up
    warm read (`:351-359`) is in flight makes a second, blocking copy.
  - `POST /api/save-source` (`playerStateRoutes.ts:47-58`) resets the cache, then calls `getDataStatus()` in the same
    request, which is always a synchronous first read.
  - The snapshot fallback (`importSnapshots.ts:52`) resets the cache on the main thread.
  - `liveLogSnapshot.ts:104-106` retries with `Atomics.wait` on the main thread.
- **Trigger:** A long save, whose `text_data.sqlite3` holds every season's news and history. The size is SUSPECTED
  to reach hundreds of MB, which would mean seconds of `quick_check` with everything else waiting.
- **Fix:** Do what `peekTransactionLog` does: answer "reading" and read in the worker. Keep `readHere` for when no
  worker can start.

### SRVINFRA-19 · M · CONFIRMED · bug — A save folder named by hand is ignored whenever the export sits in a save's own folder, yet Settings shows it as the one in use

- **Evidence:** `server/ootpSave.ts:127-162`: the manual folder is the last resort, after the csv layout, an ancestor
  `.lg` and the save-name match. `POST /api/save-source` (`playerStateRoutes.ts:47-58`) accepts any `.lg`, and
  `/api/status` reports `saveFolder: config.lgPath ?? …` (`api.ts:765`). So the GM sees the folder they typed while
  the log and date are read from another one. The save-name match also takes the first save of that name
  (`ootpSave.ts:151-153`), and two "New Game" saves are common.
- **Trigger:** The GM follows B-05's advice and names a folder in Settings ▸ Transaction log.
- **Fix:** Let an explicit manual folder win, or refuse it with the reason, and serve the folder actually used
  (`location.lgPath`). `extends B-05`.

### SRVINFRA-20 · M · PROVEN · bug — The Injury Report's SQL and `healthOf` disagree for a player without a roster-status row: he is injured to one and missing from the report

- **Evidence:** `server/health.ts:205-212` says "the SQL half of the same rule … so the two cannot drift apart", but
  `rs.is_active != 1` is NULL for the LEFT JOIN's missing row (`dashboard.ts:57-76`), so the whole predicate is NULL.
  `healthOf` reads the same player as `Injured`. If the export lacks `players_roster_status` entirely, the query throws
  and the report returns 500.
- **Proof:**

```ts
// tests/zz_review_hurt.test.ts — passes
db.prepare('UPDATE players SET injury_is_injured = 1, injury_left = 20 WHERE player_id = ?').run(p.id);
db.prepare('DELETE FROM players_roster_status WHERE player_id = ?').run(p.id);
expect(healthOf({ is_active: null, injury_is_injured: 1, injury_left: 20 })?.status).toBe('Injured');
expect(orgInjuriesWithHealth(p.org).some((r) => r.player_id === p.id)).toBe(false);
```

- **Fix:** Use `COALESCE(rs.is_active, 0)` in `HURT_SQL`, check that the table exists, and add the NULL case to
  `tests/health.test.ts`.

### SRVINFRA-21 · M · PROVEN · bug — Every integer in the export is stored as REAL, so the schema-tolerant fallback names read "Club 3.0" and the file is bigger than it needs to be

- **Evidence:** `server/importWorker.ts:206` binds `Number(v)`, and better-sqlite3 stores every JS number as REAL. The
  columns have no declared type (`:553-555`), so nothing turns 7.0 back into 7. `importer.ts:152` knows this ("numbers
  stored as REAL") and budgets disk for it (`DISK_FACTOR = 4.5`). SQL that turns an id into text then prints the
  REAL: the fallbacks `'Club ' || team_id` and `'Player ' || player_id` in `morningReport.ts:133`,
  `leagueWire.ts:184,215` and `frontOffice/teamSeason.ts:197,413`. An integer above 2^53 would also lose precision.
- **Trigger:** An export without the name columns, which those fallbacks exist for. Every import also pays 8 bytes per
  small integer.
- **Proof:**

```ts
// tests/zz_review_real.test.ts — passes
fs.writeFileSync(path.join(dir, 'teams.csv'), `team_id,league_id,level\n3,100,1\n`);   // no name column
fs.writeFileSync(path.join(dir, 'players.csv'), `player_id,team_id\n1000,3\n`);
await importCsvDir(dir);
expect(db.prepare('SELECT typeof(team_id) AS t FROM teams').get()).toEqual({ t: 'real' });
expect(db.prepare(`SELECT 'Club ' || team_id AS n FROM teams`).get()).toEqual({ n: 'Club 3.0' });
expect(db.prepare(`SELECT 'Player ' || player_id AS n FROM players`).get()).toEqual({ n: 'Player 1000.0' });
```

- **Fix:** Bind whole numbers as `BigInt` (stored as INTEGER; reads still return numbers with `safeIntegers` off), and
  shrink `DISK_FACTOR` after measuring.

### SRVINFRA-22 · L · CONFIRMED · perf — The minute's look at the saves falls back to a full scan of every save when the export is outside its save's folder

- **Evidence:** `saveDiscovery.ts:153` runs the minute's scan in `'times'` mode, so that "a folder synced to the cloud
  never blocks the server". But `chosenSave` (`:157-163`) → `locateSave` → `detectSaves()` (`ootpSave.ts:151-153`)
  scans in `'full'` mode: it stats every CSV of every save and reads every `last_date_simulated.dat`, OneDrive saves
  included, on the main thread, every 60 s.
- **Fix:** Pass the scan's own list (or `'times'`) to `chosenSave`'s lookup.

### SRVINFRA-23 · L · CONFIRMED · bug — `transactionHistory.ts` reads columns it never checked and sorts OOTP dates as strings

- **Evidence:** `server/transactionHistory.ts:48-52` checks `date` and the player columns, then selects `summary,
  message_id, team_id_0, team_id_1`. An export without one of them throws from `correlateRosterTransition`
  (`rosterStateHistory.ts:417`). `:75` sorts the dates with `localeCompare` (`2026-5-9` after `2026-5-10`), against
  AGENTS.md's `parseGameDate` rule.
- **Fix:** Check every column read, and sort by `parseGameDate`.

### SRVINFRA-24 · L · CONFIRMED · bug — A refit is thrown away when any import attempt starts, even one that is refused

- **Evidence:** `api.ts:357` bumps `importGeneration` when an import *starts*. `refitAfterImport` and
  `refitCalibrationsAfterImport` (`:256,277,284`) discard their result when the generation moved or an import is
  running. An Import Now that is refused (stale players file, no room) therefore drops a refit for the import still
  served, and none is scheduled until the next successful import or relaunch.
- **Fix:** Bump the generation at the swap (`afterSwap`), not at the start.

### SRVINFRA-25 · L · CONFIRMED · bug — Choosing a save starts the export watcher even when "Watch for new exports" is off

- **Evidence:** `api.ts:840` calls `startWatcher(csvDir)` unconditionally. The start-up path (`index.ts:133,179`) and
  `POST /settings` (`settings.ts:726-731`) honour `autoImport`. The GM then gets "export pending" notices they turned
  off.
- **Fix:** Guard it with `loadSettings().autoImport`.

### SRVINFRA-26 · L · CONFIRMED · bug — The after-import AI generations may write for a different club than the one the app follows

- **Evidence:** `api.ts:193` uses `settings.defaultOrgId ?? humanOrgId()`, and `humanOrgId` (`:219-228`) is
  `SELECT team_id FROM teams WHERE human_team = 1 LIMIT 1`, with no `ORDER BY` and no level filter. The club the app
  follows comes from `viewingOrganization.ts:13-20` (`ORDER BY team_id`), and is held back while `clubOwed()` is set
  (`frontOfficeService.ts:584`). With several human clubs, or the club question still open, the paid briefing and
  storylines can be written for another club (an affiliate marked human included), or for the automatic club while the
  GM is still being asked.
- **Fix:** Use `currentOrganization()`, and skip the generations while the club is owed.

### SRVINFRA-27 · L · CONFIRMED · outdated — The settings defaults make Opus the default model, so `DEFAULT_MODEL.anthropic` is dead

- **Evidence:** `settings.ts:140` (`model: 'claude-opus-5'` in `DEFAULTS`), and `aiModel` (`:159-168`) prefers the
  legacy `settings.model`, which the defaults always fill. `providers.ts:449-450` says the default is
  `claude-sonnet-5`, and that is never reached for Anthropic. Every AI feature defaults to the more expensive model.
- **Fix:** Remove `model` from `DEFAULTS` and keep the legacy field only when the file has it.

### SRVINFRA-28 · L · CONFIRMED · bug — The `.env` loader keeps `\r` and mis-strips quotes, and a data-folder `.env` can flip test-only switches in the shipped app

- **Evidence:** `config.ts:36-48`. The value regex `(.*)\s*$` is greedy, so a CRLF file gives `KEY="sk-…"\r`: the key
  keeps `\r` and only the leading quote is stripped. `sidecar.ts:28-31` pins only the bind variables, so a `.env` in
  the data folder can still set `OOTP_FO_DB_WRITABLE=1` (the served league opened writable with
  `synchronous=OFF`), `OOTP_FO_EXPORT_QUIET_MS=0` or `OOTP_FO_FRONT_OFFICE_WORKER=0`.
- **Fix:** Strip `\r`, parse quoted values properly, and ignore the `OOTP_FO_*` test switches from `.env`.

### SRVINFRA-29 · L · CONFIRMED · outdated — The legacy `config.json` is read forever and never migrated, and `PROJECT_ROOT` is dead

- **Evidence:** `config.ts:31-32,63-72`. The comment says "migrate it once", but the code falls back to
  `APP_ROOT/config.json` on every read. A corrupt data-folder config (SRVINFRA-03) therefore silently loads the
  repository root's or bundle's file instead. `historyIdentity.ts:209` and `servedFacts.ts:51` repeat the fallback.
  `config.ts:27-28` (`PROJECT_ROOT`) has no users.
- **Fix:** Migrate once (copy and rename), then read only the data folder. Delete `PROJECT_ROOT`.

### SRVINFRA-30 · L · CONFIRMED · bug — Logos: a missing column gives a 500, logos are missing for saves found any other way, and a changed logo stays cached for a day

- **Evidence:**
  - `logos.ts:51-56`: `SELECT logo_file_name` is unchecked in the route (`:79-85`); only `logoReference` checks.
  - `logoDir` (`:15-22`) assumes `csvDir` is `<save>.lg/import_export/csv`, so a save found by ancestor, by name or by
    hand gets no logos.
  - `logoToken` (`:34-40`) hashes only `csvDir`, with `max-age=86400`, so a logo edited in OOTP shows the old image for
    a day.
- **Fix:** Use the served save's folder (`servedSaveFolder()`), check the column, and fold the logo file's mtime into
  the token.

### SRVINFRA-31 · L · CONFIRMED · bug — The static-site export publishes local paths, can overwrite itself, and has no guard

- **Evidence:**
  - `exporter.ts:200-205` writes `/api/status` into a site meant for a public static host. It carries `csvDir`,
    `saveFolder`, `lastImport.csvDir` and `files`, so the user's home folder and name are published.
  - `:125-130`: the folder slug keeps only the date's digits from an unpadded OOTP date, so 2026-1-11 and 2026-11-1
    both give `2026111`, and the second export `rmSync`s the first. A club with a non-ASCII abbreviation gives an
    empty prefix.
  - Two concurrent `POST /export-site` share one `progress` and delete each other's folder (`:224-231`).
  - `:115-117,161-163` read `abbr` and `parent_team_id` unchecked.
- **Fix:** Strip local paths from the exported status. Build the slug from `parseGameDate`. Refuse a second export while
  one runs. Or retire the feature with the React app.

### SRVINFRA-32 · L · CONFIRMED · perf — The import reads whole files into memory, and reads large files twice

- **Evidence:** `importWorker.ts:108-140`: `readChecked` reads a whole file, or a whole range, into one Buffer, then
  feeds the parser in slices. The header says it "parses it as a stream", but it doesn't. For a file big enough to
  split, the build thread first reads all of it to find the cut points (`:461-476`). Peak memory is therefore about
  the three largest files plus the largest again. Node's whole-file `readFileSync` refuses files over 2 GiB
  (`ERR_FS_FILE_TOO_LARGE`), so a career or game-log file of that size in a very long history would fail its table.
- **Fix:** Find the cut points with positioned reads near each target, and stream each range through `createReadStream`.

### SRVINFRA-33 · L · PROVEN · perf — Every Front Office or department job spawns a fresh worker that loads the whole bundle and opens both databases

- **Evidence:** `frontOfficeService.ts:203-219`: one `new Worker` per job, no pool. Measured on the bundle under Node 24
  with an empty job (`build/sidecar/front-office-worker.cjs`): 204, 219, 169, 170, 245 ms from spawn to answer, paid
  again by every view build, decision and dossier batch.
- **Fix:** Keep a small pool (2 workers), recycled when the database generation changes.

### SRVINFRA-34 · L · CONFIRMED · dead-code — `PostImportContext.fresh` is never read, and the start-up re-run of the hooks re-runs the AI generations

- **Evidence:** `postImport.ts:21`: nothing reads `fresh`. `finishInterruptedPostImport` (`api.ts:563-578`) runs every
  hook again, including `generations` (`:546`), which spends credits when `autoGenerateAfterImport` is on, whenever
  `post-import.json` wasn't recorded for the import in force.
- **Fix:** Skip `generations` (and `remember`) when `fresh` is false, or delete the field.

### SRVINFRA-35 · L · CONFIRMED · test-gap — Claims in the code that no test backs

- **Evidence:**
  - `importCache.ts:9` says "`tests/importCache.test.ts` changes the philosophy and asserts the answer changes". The
    test (`:37-43`) only greps import lines for five module names; an indirect dependency would pass.
  - `health.ts:205-212`: no test runs `HURT_SQL` against `healthOf` (SRVINFRA-20).
  - Under `npm test` the workers are never loaded (`workerAvailable()` is false without tsx). Only
    `sidecarProcess.test.ts` exercises one, and it fails on Node 22 (SRVINFRA-10). Nothing tests a worker's posted
    error (SRVINFRA-11).
  - No test covers a corrupt settings or config file, a failure after the swap, missing required tables, the switch
    window, or a relaunch with a pending club intent.
- **Fix:** Turn the proving tests above into permanent ones (inverted), and add a cache-registry test (SRVINFRA-05).

### SRVINFRA-36 · L · SUSPECTED · bug — Stale tables are carried over into a regenerated league that reuses the same folder, id and name

- **Evidence:** `importWorker.ts:309-316` takes "the same save" to mean the same `(league_id, name)` pairs. A league
  deleted and created again in the same folder with OOTP's defaults (same id, same default name) passes, so a table
  switched off in its export settings keeps the old league's rows, marked stale but present.
- **Fix:** Compare a stronger fingerprint (`leagueFingerprint`, or the first season and a sample of player ids) before
  carrying anything over.

## The three riskiest areas, which need deeper tests

1. **The save-switch window, and what survives a relaunch.** `config.json` versus the served import's record across
   every reader: live log, save date, save name, identity, the Front Office keys, logos, pending club intents, and the
   files keyed by team id. Test: choose B and assert every served-data reader still describes A. Fail B's import and
   assert the same. Relaunch and assert the same. Then let B land and assert everything moved together
   (SRVINFRA-01, 04, 08, 09, 12).
2. **The import's commit boundary.** Everything after the rename: `last-import.json`, `afterSwap`, cache clearing, the
   marker, the hooks. Inject `ENOSPC` or `EPERM` and throwing hooks, and validate the required tables. Include the
   start-up recovery, and assert that a failed import is not "interrupted" (SRVINFRA-02, 05, 06, 17, 24).
3. **Persistence and worker lifecycle on real Node versions.** Torn or corrupt `settings.json`, `config.json` and
   `credentials.json`. Worker load failure versus a job's own failure, hangs and timeouts, run on the Node version
   contributors actually use (SRVINFRA-03, 10, 11, 15, 16).

## Upstream-era modules to retire or rewrite

- **`settings.ts` and `config.ts` persistence.** Rewrite. They are upstream JSON blobs read from disk on every call,
  written in place, global across saves, with Electron `safeStorage` and legacy-config branches. Pennant's
  invariants (per-save state, D-063 save ids, atomic writes) are bolted on beside them (`clubOwed.ts`,
  `servedFacts.ts`). Make one atomic store keyed by save id for GM inputs (club, philosophy, budget, theme) and a
  separate one for machine preferences.
- **`exporter.ts` (static site).** Retire with the React app. It is a React-only feature that crawls its own API,
  publishes local paths, and has no concurrency guard or schema tolerance. Nothing in the Mac app uses it.
- **The token-less server mode.** Retire. Electron and `npm start` run the same API with no token and no Origin check
  (SRVINFRA-07). Either give Electron a token like the sidecar, or drop the mode with the Electron client.
- **`battedball.ts`, `logos.ts` and `transactionHistory.ts`.** Rewrite onto the current conventions: `importCache` for
  anything derived from the export, the served save's folder rather than `csvDir` arithmetic, checked columns, and
  `parseGameDate` for dates. Each predates them and breaks one of them (SRVINFRA-05, 30, 23).
- **`health.ts`'s `HURT_SQL`.** Delete it, and filter with `healthOf` on a plain query. A hand-kept SQL twin of a JS
  rule has already drifted (SRVINFRA-20).
