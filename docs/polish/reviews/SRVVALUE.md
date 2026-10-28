## SRVVALUE deep hunt: report (Player Value, contracts.ts, clubFinanceRoutes, clubOwed)

Worktree: `(scratch)` (detached at e6cdd08; `node_modules` symlinked; nothing committed). Source is unchanged. I added one file of proving tests:
`(scratch)`

Each of its 4 tests asserts the correct behaviour and fails today. Run it with `npx vitest run tests/deephuntSrvValue.test.ts`.

The pure value modules (surplus, cost ladder, lens, trade combination, signings reading, contract parsing) are very carefully built and tested. I found no hidden-rating read, no 6/3/172 default and no verdict wording. The real bugs sit at the edges: which thread wrote what, which freshness each caller passes, which players a consumer selects, and the timeline after a save is reloaded.

The IDs below match the test names. They are listed most severe first.

---

**SRVVALUE-02 · H · PROVEN · bug — When the export is a day behind the save, every player loses his dollar value, while Finance still shows a price of a win**
- Evidence:
  - `playerRights.ts:1561`: a `behind` export blocks every eligibility answer.
  - So `playerValueFinances.ts` `marketStandingOf` reads every candidate as `indeterminate`, `population.market` is 0, and the price is unknown, with the false reason "No contract is a market price: Player Rights cannot establish free-agency eligibility…".
  - Payroll, Contracts, the player window, Trade and Free Agents all pass `cue.state` (`payroll.ts:103`, `contracts.ts:447`, `player.ts:127`, …), so every surplus becomes wins only.
  - But `officeViewsBuild.ts:160` (the Mac Payroll header, "A win costs about $X") and `clubFinanceRoutes.ts:29` call `leagueFinances(marketId)` with no freshness, which reads as `unverified` and computes a price.
  - The market snapshot is also recorded as `unverified`.
- Trigger: the normal case. The GM exports, sims a day, and opens Finance.
- Proof: `npx vitest run tests/deephuntSrvValue.test.ts -t SRVVALUE-02`. The header shows {central ≈ $2.11M…}, while `playerSurplus(id,{currentState:'behind'})` has no price.
- Fix:
  - Measure the price of a win and the cost ladder from salaries set at the last winter, which don't depend on today's freshness.
  - Or pass one freshness to every reader. Then any unknown price must give the true reason.
- Related to B-26.

**SRVVALUE-03 · H · PROVEN · bug — Contracts leaves out 40-man players on major-league deals who are optioned to the farm**
- Evidence:
  - `contracts.ts:436-441` selects `p.team_id = orgId AND ON_ROSTER`. That is the upstream-era population: the big-league roster only.
  - `payrollValuations` (`playerValue.ts:486`) takes the whole organization plus `contract_team_id`.
  - So an optioned player in his arbitration years, the kind whose tender decision matters, is on Payroll and missing from Contracts' arbitration and option groups.
- Proof: `-t SRVVALUE-03` (player 1208, a $2M major-league deal on the AAA club, is on Payroll and not on Contracts).
- Fix: build the Contracts population as Payroll does (`organizationPlayerStates` plus `contract_team_id`), with a farm/MLB column.

**SRVVALUE-01 · M (H on the import that brackets a winter) · PROVEN · state — Pages keep the measured price and observed winter of the previous import for the whole import**
- Evidence:
  - The observed market cache (`playerValue.ts:834`) and `costContexts` (`playerValue.ts:364`) are keyed on `contractStoreVersion()`. That is a process-local counter (`playerValueContractStore.ts:95`) that only the writing thread bumps.
  - Since N3.5, contract snapshots and pairs are written in the snapshot worker (`importSnapshots.ts:59`).
  - `import-finished` is published before the post-import hooks run (`api.ts:409-411`). Any request in that roughly 2–3 s window, such as the Mac refreshing the Morning Report, fills the cache without the new pair. Nothing clears it afterwards: `snapshotsAfterImport` only calls `noteSnapshotsWritten()`, which covers rating history.
  - Result: the measured price, awards and reserve renewals stay one import behind. The Front Office worker and the market snapshot (fresh threads) then disagree with the pages.
  - The caches also gain one entry per version bump and never drop any.
- Proof: `-t SRVVALUE-01` simulates the worker's write; the read still shows 0 pairs, expected 1.
- Fix: call `clearProductionCaches()` (or bump the version) on the main thread when `snapshotsAfterImport` resolves, or key the cache on a `MAX(rowid)` read from history.db.

**SRVVALUE-04 · M · PROVEN · bug — After the GM reloads an earlier save, the abandoned branch's pairs are still counted in the measured price**
- Evidence:
  - `playerValueSignings.ts:172-178`: when a new import is dated before the previous one, the date branch wins and the new segment starts at the new import's date, not at the break's go-back date. Only imports after the new date are superseded.
  - Example: imports 4-1, 5-1, 6-1; the GM reloads 4-1 (break at 4-1); the next import is 5-15. The pair 4-1 → 5-1 from the abandoned timeline stays in the pairs, and 5-1 is never superseded.
  - `pruneContractSnapshots` then deletes snapshots by this timeline, and that cannot be undone.
  - Separately, `captureMarketSnapshot` (`playerValueSnapshot.ts:165`) never forms the true pair 4-1 → 5-15.
- Proof: `-t SRVVALUE-04` (superseded is `['2041-06-01']`; it should include 2041-05-01).
- Fix: when a break lies between two imports, start the segment at `min(break.gameDate, imp.gameDate)`, and form the pair from the go-back import.

**SRVVALUE-05 · M · CONFIRMED · bug — A free agent's market figure goes below the league minimum, often into negative dollars**
- Evidence: `playerValueSurplus.ts:625` computes minimum + wins × price, edge against edge.
- The 80% low edge of wins is usually negative, so "Could be −$1.7M to $14M" is served as "what this league's market pays" (`presentation/finance/freeAgents.ts:73,91`). No club can pay below the minimum.
- Fix: floor the market figure at the minimum (say so in the hover), or re-word it as production value rather than what the market pays.

**SRVVALUE-06 · M · CONFIRMED · perf — The market history grows by one ~30 KB row per import, and it is read whole on every Finance read**
- Evidence:
  - `basis_json` measured 28 KB per import on a synthetic league of 30 clubs.
  - `clubFinanceRoutes.ts:34-36` serves `history: marketSnapshotHistory()` with every basis, and parses all rows twice (`priceHistory`).
  - Every Finance office-view build calls `marketPriceHistory` (`officeViewsBuild.ts:161`).
  - With daily imports over several seasons that is megabytes per request.
- Fix: add a summary column (stage and price) for the history, and read `basis_json` only for the latest row.

**SRVVALUE-07 · L · CONFIRMED · test-gap — The boundary test checks the start-up market record, not the import's, and the module docs are stale**
- Evidence:
  - `tests/playerValueBoundary.test.ts:704-711` asserts that `captureMarketSnapshot(` appears once in `api.ts`. That call is the start-up `recordImportMarket`.
  - The real import path (`importSnapshots.ts`, a worker) is untested for that invariant.
  - `playerValueSnapshot.ts:21` still says "Written once per import from runImport".
  - This gap is how SRVVALUE-01 slipped in.
- Fix: add a test that takes the snapshots through `snapshotsAfterImport` and then reads `leagueFinances`.

**SRVVALUE-08 · L · CONFIRMED · bug — A blank contract row reads "majors" as level 1**
- Evidence: `playerValue.ts:305` sets `majorLeagueClub: state.level.value === 1`.
- In an independent league whose top level isn't 1 (D-16, `marketLevels`), a blank-row major leaguer's later seasons are always `indeterminate`.
- Fix: use `marketLevels()`.

**SRVVALUE-09 · L · CONFIRMED · bug — The club's value of a win assumes a 162-game season in its basis**
- Evidence: `playerValueWinValue.ts:103` (`r.talent * 162`) gives a wrong "pace of N wins" for 60-, 100- or 154-game leagues.
- Fix: use the league's games per team.

**SRVVALUE-10 · L · CONFIRMED · doctrine — The web client shows playoff odds outside Standings (D-060)**
- Evidence: `/club-finances` (`clubFinanceRoutes.ts:38`) and `/our-view` (`ourViewRoutes.ts:46`) serve `winValue`, and `src/pages/Payroll.tsx:529`, `src/ValueSection.tsx` and `TradeAnalysis.tsx` show it. The Mac app doesn't.
- Fix: stop serving `winValue` outside Standings, or retire it from the web pages.

**SRVVALUE-11 · L · CONFIRMED · bug — `/api/player-value?ids=` reads without the export's freshness**
- Evidence: `playerValueRoutes.ts:35`. The single-player routes on the same file use `current()`, so the batch read can disagree with them on a stale export.
- No client uses this route.
- Fix: pass `current()`, or retire the route.

**SRVVALUE-12 · L · CONFIRMED · bug — Contracts throws instead of tolerating a missing table or column**
- Evidence: `contracts.ts:436-441` joins `players_roster_status` and reads `p.retired` without checking either exists. The route only checks `players` and `players_contract` (`:525`).
- Result: a 404 carrying a SQL message.

**SRVVALUE-13 · L · CONFIRMED · bug — Small money and wording slips**
- `playerValueSurplus.ts:203`: $999,600 prints as "$1000K".
- `:566`: "seven seasons" is hard-coded beside `CONTROL_HORIZON_SEASONS`.
- `playerValueControl.ts`: `status.replace('_',' ')` writes "pre arbitration".

**SRVVALUE-14 · L · SUSPECTED · state — `leagueFacts` is cached by league only**
- Evidence: `playerValue.ts:1177`. It is cached per league, while its schedules and rates are computed from the season the first caller passes (`season ?? 0` when that is null). A first call with a null season would poison it until the next import.

---

### Riskiest areas needing deeper tests
1. **Player Value state across threads.** Process-local caches and counters (`costContexts`, `observedCache`, `contractStoreVersion`) sit beside history.db tables written by worker threads (snapshots, and refits recorded on main). No test runs the real worker path and then reads.
2. **Freshness threading.** Each consumer picks its own `currentState`, some pass none. Needed: one test that serves every value route and office view on a `behind` export and asserts one price and one eligibility per player. Also an owner decision on whether the market price should depend on today's freshness at all.
3. **The contract-history timeline and pruning.** Reloads, replays and re-imports drive an irreversible DELETE (`pruneContractSnapshots`). Only three timeline scenarios are tested.

### Upstream-era code to retire or rewrite
- **`contracts.ts`'s population and legacy fields.** The `ON_ROSTER` roster selection, the `LEGACY` status mapping, and `flags`, `endYear`, `arbYear`, `yearsAfterThis` ("for the assistants' older reading") are kept beside the newer summary. Rebuild Contracts on Payroll's population and the summary alone.
- **`/api/player-value?ids=` and the web client's value-of-a-win lines.** Unused or against doctrine.

### Notes
- Timings on a synthetic league of 960 players: the league-wide valuation took 540 ms; one player took 100 ms cold and about 12 ms warm. These were informational and not reported as a finding.
- No permission refusals. I didn't touch the owner's data, OOTP files or the Keychain.