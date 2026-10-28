# SRVDEV deep hunt: scouting evidence, rights and development (read-only)

**Setup.** I worked in the worktree `(scratch)`, detached at e6cdd08, with `node_modules` symlinked. Nothing was committed or pushed. No app or UI test was run, and no real data, OOTP file or Keychain was touched. The stale `wt-srvdev` was left alone.

**Proving tests.** All are in `<worktree>/tests/`. Each asserts the correct behaviour, so a failure is the bug. Run them with `npx vitest run tests/deephuntSrvdev*.test.ts`: 15 fail. The existing `evidenceBoundary` and `developmentalStakesBoundary` tests still pass.
- `deephuntSrvdevNone.test.ts`: 5 fail, 1 control passes.
- `deephuntSrvdevStakesSource.test.ts`: 1 fails, with 3 soft assertions.
- `deephuntSrvdevCurrentAssignment.test.ts`: 2 fail, 1 control passes.
- `deephuntSrvdevScale.test.ts`: 2 fail.
- `deephuntSrvdevSchema.test.ts`: 1 fails.
- `deephuntSrvdevBoundary.test.ts`: 3 fail. This is the whole-server scan; its failure lists the escapes.
- `deephuntSrvdevHistoryLoad.test.ts`: a timing measurement.

## Findings, most severe first

**SRVDEV-01 · H · PROVEN · doctrine: "Show no player ratings" is not enforced on the card, roster grid, pitching staff or draft board**
- **Evidence:**
  - Only the adapter's own loaders check `ratingsWithheld()` (`loadScoutedAbilities`, `scoutedGloves`, hitter profiles, populations).
  - The two doors other modules use don't check it:
    - `ratingFrom()` (`scoutedEvidence.ts:362`): `findViews` returns `NO_VIEWS`, so it falls through to `mainTableFrom`.
    - `scoutedRatingRow()` (`:418`) returns the main row.
  - Those doors are used by `player.ts:161-163` (`battingRatings`, `pitchingRatings`, `pitches`, `velocity`, `positionRatings`, `fieldingRatings`), `roster.ts:134`, `pitching.ts:131` and `rosterops.ts:844` (the React draft board).
- **Proof:** with mode `none`, the evidence status is `unknown`, yet `ratingFrom('batting')` returns `"players_batting"`. The card shows contact 50, the roster grid grades players `[11, 16, 32]`, and the staff shows stamina and stuff for pitcher 14.
- **Trigger:** OOTP's export setting "Show no player ratings". What OOTP writes into the main tables in that mode isn't established. Whatever it is (zeros or true values) is shown as grades, while D-061 says "every rating unknown".
- **Fix:** `ratingFrom` returns null and `scoutedRatingRow` blanks the rating columns when ratings are withheld. Callers must treat null as unknown; see SRVDEV-05.

**SRVDEV-02 · H · PROVEN · doctrine (D-068): the stakes lines carry, and then serve, lines measured on another ratings source**
- **Evidence:**
  - `stakesLinesRefit.ts:57-63` (`inForceBefore`) uses `latestCalibrationAttempt`, which has no source filter (`saveCalibrationStore.ts:304`).
  - A thin or failed measurement then carries those lines as `'carried'` / `'carried_unmeasured'` (`stakesLines.ts`, in `measureCeilingLines`) and records them under today's source.
  - `stakesLinesFor` (`:222-225`) serves `latest.model.inForce` because the latest attempt is on today's source. The result is `source: 'save'`, with no `setAside` sentence.
  - In the passing case, the other source's lines become `previous`, so the "the lines moved" sentence blames a change of source on the league.
- **Proof:** lines adopted on `export:real`, then a thin measurement on today's source. It carries hitters 56/…, and `stakesLinesFor` serves them as `'save'` instead of the starting lines.
- **Trigger:** the ratings source changes (for example, real to OSA, or complete scouted ratings switched on), and the next measurement is thin or fails its check.
- **Fix:** `inForceBefore` keeps only an attempt on the same source, else uses `startingLines`. Stamp the source on `inForce` and check it in `stakesLinesFor`.
- **Note:** `mlbCalibration.ts:317` uses the same unfiltered helper; worth a look.

**SRVDEV-03 · M · PROVEN · doctrine (D-018): an unknown age profile is read as "not young for it", so an overmatched player becomes `too_advanced`**
- **Evidence:** `currentAssignment.ts:276-288`. The window `indeterminate` skips the `ample` branch and says "is not young for it". `holding` plus an unknown window says "still has developmental value" (`:291-299`).
- **Fed by:** `farmOperations.ts:779`.
- **Consumed by:** `farmAssignments.ts:317`, `farmRetention.ts:220`, `farmAffiliate.ts:591`.
- **Trigger:** `developmentalContext` reports the profile `unavailable`. That happens with no `team_roster` table, a league and level pool under `LEAGUE_POPULATION_MINIMUM` (small or fictional leagues), or an unknown age.
- **Fix:** overmatched with an indeterminate window becomes `indeterminate`, with the age profile as the missing evidence. Drop the developmental-value claim.

**SRVDEV-04 · M · PROVEN · bug: a change of OOTP's rating display scale is read as development**
- **Evidence:** snapshots keep native grades and no scale (`history.ts` never names one). `loadScoutedObservations` converts every past snapshot with today's detected scale, unclamped. The assumption is stated in the comment above it (`scoutedEvidence.ts:~1236`) and is never checked.
- **Proof:** 5 on a 1-10 display then 50 on 20-80 gives an observation of 5 on "20-80" and a trend `currentDelta` of 45.
- **Fix:** stamp the scale on each snapshot (beside the D-061 mode stamp) and treat a scale change as a switch, or store snapshots normalised.

**SRVDEV-05 · M · PROVEN · bug: an export without a pitching (or batting) ratings table crashes the pitching staff and the draft board**
- **Evidence:** `ratingFrom('pitching')?.from ?? 'players_pitching'` at `pitching.ts:131` and `rosterops.ts:844-845` names a table that isn't there.
- **Proof:** with the table renamed, `computePitchingStaff` throws `no such table: players_pitching`.
- **Fix:** with no source, select NULLs.

**SRVDEV-06 · M · PROVEN · test-gap/doctrine: the evidence boundary has escapes across the whole server (extends SRVSTATS-01)**
- **Evidence:** the guard in `tests/evidenceBoundary.test.ts` covers only the GUARDED list. A whole-server scan finds:
  - `history.ts`, `pitching.ts`, `player.ts`, `roster.ts`, `rosterops.ts` and `valuation.ts` name raw rating columns or main rating tables.
  - `trade.ts` reaches `glovesLine`.
- **Latent escapes:**
  - `roster.ts:33-34` has a `['players','running_ratings_speed']` candidate. It reads `players` directly, because no family matches and the code falls back to `"${table}"`.
  - `ratingFrom` is exported and returns a raw SQL expression, so any joiner inherits the SRVDEV-01 hole.
- **Fix:** run the scan over the whole server with an explicit allow-list (the adapter, `gloves.ts`, and the scale probe). Forbid `?? 'players_*'` fallbacks. Make `gloves()` and `glovesLine` private to the adapter.

**SRVDEV-07 · M · PROVEN (measured) · perf: on the export where the stakes lines moved, every reader loads the save's entire rating history (extends SRVSTATS-15)**
- **Evidence:** `developmentalContext.ts:212-224` calls `loadScoutedObservations(null)` to find one row per player. A reader is opened per call at `org.ts:898` (`computeProspects`, run several times per MLB report) and at `scoutedDevelopment.ts:122`.
- **Measurement:** 300,000 snapshot rows take 3.4 s per load. A real save is about 7,000 players per snapshot.
- **Fix:** have SQL return only the latest snapshot before the date, for the players asked about. Cache it per import.

**SRVDEV-08 · M · CONFIRMED · doctrine (show the basis, D-061/D-067): grades are labelled "Your scouts'" whatever their source**
- **Evidence:** hard-coded hints in:
  - `presentation/clubhouse/rosters.ts:41`, `:68`
  - `pitching.ts:83`
  - `depth.ts:126-127`
  - `lineup.ts:36`, `42`, `68`, `118`, `169`, `182`
  - `finance/freeAgents.ts:67`, `183`
  - `player/words.ts:110`
- None of these reads `ratingSource()`.
- **Effect:** in a "real" export without the file, true ratings are called your scouts' grades. In OSA mode, OSA's view is.
- **Fix:** serve `ratingSource().short`. Related to B-34.

**SRVDEV-09 · L · SUSPECTED · doctrine: OSA's file view replaces the main tables only when the kind is known to be `real`**
- **Evidence:** `scoutedEvidence.ts:241` (`osaEvidence` requires `mode === 'real'`).
- **Trigger:** the kind is `unknown` (settings changed after the export, or missing), the file carries OSA rows but none of ours (0 or 2+ human clubs). The main tables, which may be true ratings, become the evidence.
- **Fix:** prefer the file's OSA rows when the kind is unknown.

**SRVDEV-10 · L · CONFIRMED · doctrine (D-020): the card says "Optioned this season" / "Not optioned this season" from `options_used_this_year`**
- **Evidence:** `presentation/player/dossier.ts:297`.
- **Why it's wrong:** the counter is an option year *charged*.
  - It is charged at the next rollover, so a man optioned today reads "Not optioned this season".
  - The Nance case (RIGHTS_RESEARCH §3.4) charged one without an option move.
- **Fix:** "An option year charged this season" / "None charged yet".

**SRVDEV-11 · L · CONFIRMED (code) / SUSPECTED (trigger) · robustness: the organization CTEs have no cycle guard**
- **Evidence:** `WITH RECURSIVE … UNION ALL` on `parent_team_id` at `scoutedDevelopment.ts:95`, `org.ts:131`, `farmOperations.ts`, `minorLeagueRoster.ts` and `mlbEvidence.ts`.
- **Trigger:** a self-parented or looping team recurses without end and hangs the thread. `developmentalContext` and `leagueRules` already guard against loops.
- **Fix:** use `UNION`, or a depth limit.

**SRVDEV-12 · L · CONFIRMED · D-018: unknown age and IL status are served as 0 and false**
- **Evidence:** `scoutedDevelopment.ts:136` (`age: Number(r.age)` gives 0) and `:146` (`onInjuredList` is false when the flag is unknown).

**SRVDEV-13 · L · CONFIRMED · perf: the roster-state snapshot re-reads two whole history tables for each change it finds**
- **Evidence:** `rosterStateHistory.ts:418` calls `transactionHistory.ts:23-55` for each transition. That is an OR over about 20 unindexed `trade_history` player columns, plus injury history.
- **Effect:** it runs in the snapshot worker, but a season rollover times a long trade history is quadratic.
- **Fix:** read both tables once per capture.

**SRVDEV-14 · L · CONFIRMED · basis wording: a missing row is blamed on OOTP**
- **Evidence:** `UNKNOWN_REASON_TEXT.not_exported_by_ootp` ("OOTP does not export this field") is also used for "no row for this player" and "blank" (`playerState.ts:157-160`).
- **Effect:** rights messages blame OOTP for a missing roster-status row.
- **Fix:** surface `Sourced.note` instead.

**SRVDEV-15 · L · SUSPECTED · authority chain: philosophy can prefer "stay" without Player Development's read of the current level**
- **Evidence:** `assignmentPreference.ts` (the `ordered` list) treats "stay" as always valid and never consults the current-assignment read.
- **Effect:** a patient organization gets "stay" preferred for a man Player Development reads as `no_longer_developmental`.

## Riskiest areas needing deeper tests
1. **The rating-source matrix.** Export kind {scouted, real, osa, none, unknown} × file {absent, ours, OSA only, both, stale} × viewer {resolved, ambiguous} × evidence or population. It should be tested against every reader: card, roster, staff, draft, snapshot, gloves, splits, populations. The withheld, OSA-in-place-of-real and OSA-fill rules live in different places. SRVDEV-01, 06 and 09 are all gaps in this matrix.
2. **Per-save fit source bookkeeping.** `latestCalibrationAttempt` is unfiltered and carried "in force" values travel across sources (SRVDEV-02). Audit the MLB calibration's `latest` with the same test.
3. **Rating history normalisation.** Snapshots are native, unstamped by scale (SRVDEV-04), with partial composites (SRVSTATS-21). Development trends, peer pace, `ratingsForward` and the Player Value fits all read them.

## Upstream-era code to retire or rewrite
- **`gloves.ts`:** fold the raw reader into the adapter. `glovesLine` should take `scoutedGloves`.
- **`roster.ts` `RATING_SPECS` / `locateColumn` candidates:** pre-adapter schema guessing. The adapter should own the column set.
- **`rosterops.ts` `computeDraft`:** a React-only raw grade reader that duplicates the adapter path `scoutingViews.ts` already uses.
- **`valuation.ts` `ratingScaleMax`:** a max-scan heuristic over the main tables. Move it into the adapter and stamp it per snapshot.
