## SRVPRES deep hunt: pages and the contract (read-only, origin/feature/swiftui e6cdd08)

Worktree: `(scratch)`. The main checkout's `node_modules` was too old (it had no `ajv-formats`), so I ran `npm ci` in the worktree. Nothing was committed. I used synthetic saves only: no real data, no app launch, no Swift UI tests.

### Findings, most severe first

**SRVPRES-01 · H · PROVEN · doctrine/bug: With no live log, the Front Office never notices OOTP simming past the export, so control and costs stay "known" (D-022, D-018)**
- **Evidence:** `server/frontOfficeService.ts:157-160`. `inputsKey` is `frontOfficeImportKey` plus the log's db/wal file stats, or `no-log`. Freshness comes from the save's `settings/last_date_simulated.dat` (`freshnessCue`), and no key reads it. The Morning Report reads freshness (`server/morningReport.ts:177`, `playerValues(..., { currentState: freshnessCue(status).state })`), and so do the farm, clubhouse and player builds. Finance, Trades and Philosophy add `cue.state/lagDays` to their keys (`officeViewService.ts:57-60`, `tradeDeskService.ts:34-36`, `philosophyViewService.ts:134-136`). The Front Office, clubhouse (`clubhouseViewService.ts:72`), farm (`farmViewService.ts:63`), player dossiers (`playerViewService.ts:77`) and club reports do not.
- **Trigger:** "Transaction history unavailable", which is the owner's state per B-05, or a save found without its log. The GM sims days in OOTP and doesn't re-export.
- **Result:** Data Status says "behind", but the Morning Report, roster map, dossiers and farm keep serving values and control as current.
- **Proof:** `tests/srvpresProbeOrgComparison.test.ts`, second describe: `npx vitest run tests/srvpresProbeOrgComparison.test.ts`. The key is unchanged while `freshnessCue().state` goes current → behind.
- **Fix:** Put `cue.state/lagDays` (or the date file's stat) in `inputsKey`.
- Related to B-26 but distinct: this is a stale cache, not two builders.

**SRVPRES-02 · M · PROVEN · bug: Org Comparison is kept after the export falls behind, and re-stamped as current**
- **Evidence:** `server/leagueViewService.ts:80` keys League Office on `frontOfficeImportKey`, which has no freshness. Yet `orgComparisonViewOf` passes `getDataStatus()` (`leagueHistoryViews.ts:50`) to `computeOrgComparison`, which values players with `currentState: cue.state` and serves its own freshness line (`franchise.ts:315, :348, :411`). `served()` (`leagueViewService.ts:117-120`) then re-stamps the old payload with the current stamp.
- **Trigger:** The GM sims in OOTP after an import.
- **Result:** Finance's key moves and Finance says "behind" with control unknown. Org Comparison keeps the build from when the export was current.
- **Proof:** Same file, first test. The kept comparison has no "behind" line; a fresh build does.
- **Fix:** Key Org Comparison like Finance (add `cue.state/lagDays`), or move it to Finance's cache.

**SRVPRES-03 · M · PROVEN · perf/state: Any write to settings.json rebuilds every department**
- **Evidence:** `frontOfficeService.ts:287-289` puts settings.json's size and mtime into every key. Settings.json is rewritten on every save:
  - a theme-pack choice for any club (`settings.ts:247-253`);
  - light/dark;
  - AI provider or model;
  - the import toggles;
  - even a no-op `POST /api/settings` (`settings.ts:724`).
- **Result:** Every one moves the key for the whole Front Office and every department's views. The next read pays a cold build in the worker. `/api/status`'s `reportStamp` goes null until it finishes, and `front-office-updated` then makes the Mac reload everything.
- **Proof:** `tests/srvpresProbeKeys.test.ts`. A theme-pack choice for another club gives Front Office builds +1 and League builds +1; `POST /api/settings {theme:'dark'}` gives builds +1.
- **Fix:** Key on a digest of only the fields the answers read: this club's philosophy, its budget, `roundRatingsToFive`, `showUnavailablePitchers`.

**SRVPRES-04 · M · PROVEN · robustness/perf: One farm reader failing takes down all five farm views, and every click rebuilds the whole farm**
- **Evidence:** `server/farmViewsBuild.ts:89-127` has no part isolation. League (`leagueViewsBuild.ts:78-90`), Finance (`officeViewsBuild.ts:80-96`) and clubhouse do. `farmViewService.ts:73-107` never keeps a failure.
- **Trigger:** Any throw in prospects, scouted development, history or the words on a real export. Under the worker, the first one also flips `workerBroken` (SRVINFRA-11).
- **Proof:** `tests/srvpresProbeFarmPart.test.ts` mocks `computeProspects` to throw. Organization and Affiliates (which never read prospects) both reject. Three requests run three full farm-system reads.
- **Fix:** Give each part its own failure answer, and keep a failed build for its key.

**SRVPRES-05 · M · PROVEN · perf: Player Search sorted by a stat is quadratic in league size, on the server's thread**
- **Evidence:**
  - `server/league.ts:394-396`: a stat sort drops the `LIMIT`.
  - `scoutingViews.ts:196` passes `level:'all'`.
  - `league.ts:422`: `rows.find(...)` runs inside the loop over stat rows.
  - Then a JavaScript sort over everything (`:499-512`).
  - It runs in process (`leagueViewService.ts:243-251`). The header calls it "a bounded query".
- **Proof:** `tests/srvpresProbeSearch.test.ts`, run with `--reporter=verbose`.
  - 1,200 players: 28 ms
  - 2,400 players: 88 ms
  - 4,800 players: 285 ms (a plain-column sort takes 9-15 ms)
  - A real all-levels league is roughly 10-15k players, which projects to seconds per sort, page or keystroke.
- **Fix:** Look up rows through a Map, sort in SQL or in the worker, and cap the match set.

**SRVPRES-06 · M · PROVEN · test-gap: The banned-jargon check never reads most shown strings, which is why B-01 shipped (extends B-01)**
- **Evidence:** `tests/bannedJargon.ts:166` (`SHOWN_FIELDS = text|hint|display`). `basisStrings` (`:191-211`) reads only because, unknown, wouldChange and lean. `basis.stamp`, `basis.source` and other string fields are never read.
- **What the committed fixtures carry today:**
  - `npm`, `.ts`, `(D-050)` and `Q-` in `basis.stamp`, on getFrontOffice, getClubReport, getFarmAssignments, getFarmDecision and getPlayerDossier.
  - A shown `p10 / p50 / p90` and a code constant (`CEILING_LINES`) on the farm's lines table.
- **Proof:** `tests/srvpresProbeJargon.test.ts`, which writes `probe-jargon.txt` in the worktree.
- **Fix:** Walk every string except a short list of code fields, and hold stamp and source to a developer-provenance list.

**SRVPRES-07 · M · CONFIRMED · doctrine (D-018): Payroll room shows a green "$X free" while unstated salaries are left out of the total (extends B-13)**
- **Evidence:** `server/payroll.ts:300-307` computes headroom = budget − total, where `total` excludes covered salaries the export leaves blank (`unstated`, `:226`). `presentation/finance/payroll.ts:128-131` then draws a definite "free" in green, and only the basis mentions the gap.
- **Fix:** When `unstated > 0`, say "At most $X free" with a caution or unknown tone.

**SRVPRES-08 · L · CONFIRMED (fixture scan) · bug: Farm Organization's lines table sorts on values that don't match what it shows**
- **Evidence:** `presentation/farm/organization.ts:109-121`. The sort keys are:
  - `name` sorts by the code constant (`BODY_COUNT`, `CEILING_LINES …`);
  - `why` sorts by the basis, which is what the Name column shows;
  - `kind` sorts by the raw status (`provisional` shown as "Starting value");
  - `value` sorts by a JSON blob string.
- No other table in the fixtures has this mismatch, apart from date/club formatting keys.
- **Fix:** Build sort keys from the displayed cells.

**SRVPRES-09 · L · CONFIRMED · bug: The dossier's "this season" hover line can pick the wrong row**
- **Evidence:** `presentation/player/dossier.ts:320-340` sorts by `LEVEL_ORDER.indexOf(levelName)`. An unlisted label (`L7` and up from `player.ts:196`, since `LEVEL_NAMES` covers only 1-6) returns -1 and sorts ahead of MLB. Rows are also grouped per team (`player.ts:184`).
- **Trigger:** A rehab stint at a Rookie/complex level shows "2040: L7 · 12 PA …" instead of his MLB line. A traded player shows one club's share as the season.
- **Fix:** Rank unknown levels last, and sum the season's rows at the chosen level.

**SRVPRES-10 · L · CONFIRMED · doctrine (D-018): An unknown is served as zero or as "none" (extends B-02)**
- `morning.ts:204-207`: when outs are unknown (no stats table or no season), it says "No major-league innings this season".
- `league/standings.ts:272`: `servedValue(race.wildcardGb ?? 0, …, 'Not in a place')`. It should be `unknownValue`.
- `server/playoffs.ts:110`: `divisionGb = mine.gb ?? 0`, so a blank gb reads "Games back: None".

**SRVPRES-11 · L · CONFIRMED · doctrine: The Draft Board compares dates with its own parser instead of `parseGameDate`**
- **Evidence:** `presentation/clubhouse/common.ts:97-100` (`dayOrder`, anchored `$`) and `scouting/draftBoard.ts:316` (`(dayOrder(x) ?? 0) > (dayOrder(y) ?? 0)`).
- **Trigger:** A date with a time suffix reads as null, so `ahead` comes out true and the board says "OOTP publishes it on <a past date>".
- `schedule.ts:110` sorts with the same helper.

**SRVPRES-12 · L · CONFIRMED · test-gap: Many contract fixtures are never decoded by Swift**
- No Swift test decodes about 34 response fixtures. They include seven department reports (finance, frontOffice, league, medical, philosophy, scouting, trades), `getDataStatusWords-configured`, `chooseTheme-*`, `removeStaffNote-*` and several `setPlayerNote-*`.
- Swift's reading of open enums and lifted nulls is proven only on the fixtures that are referenced.
- **Fix:** One `PennantAPITests` case that decodes every file in `contract/fixtures/responses` as its operation's response type.

**SRVPRES-13 · L · CONFIRMED · bug: A farm decision built on a click is kept without checking that nothing moved**
- `farmViewService.ts:141-170` keeps it without the generation and key check every other asked-view cache makes.
- A decision read across an import's swap mixes the old build's `system` with the new database, and it is kept.

**SRVPRES-14 · L · CONFIRMED · robustness: Raw internal error messages reach the app**
- `officeViewsBuild.ts:84-90` treats any error whose message starts "No " or "Unknown " as a refusal already worded for the GM, so a raw message like "Unknown org" is served as the reason.
- The `/v2` 500 handler sends the raw `err.message` as `detail` (`v2Routes.ts:369-374`).

**SRVPRES-15 · L · CONFIRMED · bug: "The budget you expect next season" is used for every later season too**
- `payroll.ts:303-306` and `officeViewsBuild.ts:135` apply it to seasons +2 and +3, which are labelled "against the budget you expect next season".

**SRVPRES-16 · L · CONFIRMED · perf/consistency: Trade analysis ignores a league upgrade in progress**
- `tradeDeskService.ts:152-176` doesn't wait for `leagueUpgradeUnderWay()`, unlike every other view service. It runs on the server's thread, so during an upgrade it reads the unindexed old file.

**SRVPRES-17 · L · SUSPECTED · perf: Every `/v2` response is re-checked and re-serialized**
- `send()` re-walks `assertAuthored` and re-serializes kept payloads of 100-270 KB on every request (`v2Routes.ts:84-87`). The dossier route already keeps bytes for exactly this reason (review M5).

### Checked and found sound
- I ran every JSON GET in the contract against 5 synthetic variants the drift test never builds, validated in the strict closed form: Opening Day, a brand-new league, no salaries or finances, no farm or season, and a season played out. All shapes held: no NaN-to-null and no non-integer `Integer`. Probe: `tests/srvpresProbeContract.test.ts` (`PROBE=all`), output in `probe-report-all.txt`.
- No odds or posture outside Standings, no verdict words in Trades or Free Agents, and the presentation layer makes no runtime calls into the specialists.
- Draft Board, Player Search and decision caches are bounded. Tokens and sort are whitelisted, and logos use `safeJoin`.

### Three riskiest areas
1. **Cache keys are assembled by hand in each service.** Freshness is in some keys and not others (01, 02), and the settings mtime is far too broad (03). This needs one declared inputs contract per view, plus a test that each key moves exactly when its inputs move.
2. **Failure handling in builds.** The farm has no part isolation, and no service keeps a failed build (04). The whole Morning Report sits in one `try` (`frontOfficeBuild.ts:183-193`), and `claim()` throws an AuthoringError on a single bad number, so one odd value can blank a whole section.
3. **What the GM sees is barely tested.** The jargon walk covers only a few fields (06), Swift decodes only some fixtures (12), and the drift test runs on one synthetic save. I'd promote the 5-variant probe into the drift test.

### Upstream-era code to retire or rewrite
- **`server/league.ts` `computePlayers`:** the React-era players route now behind Player Search. Quadratic with a stat sort, unbounded, and on the server's thread (05). Rewrite it with the sort in SQL.
- **`server/playoffs.ts`:** `gb ?? 0`, and its summary strings are React-era.
- **`server/pitching.ts:163` (outside my slice, SUSPECTED):** it uses `MAX(year)` over every league and level as "this season". In a multi-league save, or in spring before games, it can show the wrong year.

### Proving tests left in the worktree
All are under `tests/`. Each one passes while its bug is present, because it asserts the buggy behaviour.
- `srvpresProbeOrgComparison.test.ts` (01, 02)
- `srvpresProbeKeys.test.ts` (03)
- `srvpresProbeFarmPart.test.ts` (04)
- `srvpresProbeSearch.test.ts` (05, timings with `--reporter=verbose`)
- `srvpresProbeJargon.test.ts` (06, writes `probe-jargon.txt`)
- `srvpresProbeContract.test.ts` (the sound-contract check, writes `probe-report-<variant>.txt`)
