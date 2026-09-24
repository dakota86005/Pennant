# Project state

Point-in-time snapshot from repository inspection on **2026-09-21**. Verify
this document against the current worktree before relying on it; update it when
material implementation state changes.

## Repository snapshot

- Product **Pennant**, version `0.1.0` (package `ootp-front-office`, a compatibility-held name; D-049). Pennant's
  version lineage is its own and is unrelated to upstream's numbers; `package.json` is the only source of the version.
- Baseline: `main` carries the evidence boundary (PR #1), the Player State foundation (PR #2), Player Rights
  (PR #3), MLB Operations v2 with its scouting layer and hardening (PR #4), Minor League Operations v2 with its
  hardening (PR #5), windowed farm usage (PR #6, D-048), the Pennant consolidation (PR #7, D-049) and the
  developmental-stakes rebuild (PR #8), which rebuilt what sits under Player Development's protection tier (D-050,
  [DEVELOPMENTAL_STAKES.md](DEVELOPMENTAL_STAKES.md)) and, in its hardening pass, drew "short of developmental
  work" once for the club and the man (D-051).
- Stack: TypeScript, React 18, Vite 6, Express 4, SQLite via `better-sqlite3`, Electron 41, and Vitest 4.
- Validation at this snapshot: `npx tsc --noEmit` clean, `npm test` 143 files / 1,868 tests passing,
  `npm run build` succeeds. The behavioral corpus ([BEHAVIOR_CASES.md](BEHAVIOR_CASES.md)) is 159 tests for MLB
  Operations, 371 for the farm and 96 for developmental stakes.
- `origin/feature/mlb-operations` is **not merged** and was audited end to end ([MLB_OPERATIONS.md](MLB_OPERATIONS.md)
  §2); it is kept for that audit's `git show` references. `rosterStateHistory.ts` and `transactionHistory.ts` were
  ported earlier in adapted form; `rosterTransactionState.ts` is superseded; the rest was replaced, modified or deferred
  per component. The other feature branches are fully merged (see the branch audit in PENNANT_CONSOLIDATION.md §3).
- No release has been published from this repository: `origin` has no tags and no GitHub releases. The `0.1.0`
  heading in [../CHANGELOG.md](../CHANGELOG.md) records the milestone; it has not been tagged (the tag will be
  `pennant-v0.1.0`).

## Implemented application foundation

### Import and local runtime

- Detects common OOTP Baseball 27 save locations and accepts a selected save,
  `.lg` directory, saved-games directory, or CSV export directory.
- Imports all available CSVs into SQLite with delimiter/encoding detection,
  numeric conversion, schema discovery, progress reporting, transactions, and
  generated indexes.
- Watches selected exports and can re-import automatically.
- Stores replaceable imported data separately from persistent rating history,
  watchlist/notes, settings, chat histories, credentials, and AI caches.
- Runs as a local Express/React web app or a packaged Electron application.
  The desktop shell embeds the same server on a remembered/fallback local port.
- Binds to loopback by default, applies a Host allowlist against DNS rebinding,
  and supports explicit unauthenticated LAN binding with warnings.
- Can export a read-only static website snapshot.

### Front-office surfaces

The repository contains server routes and React pages for dashboard, standings,
schedule/game plans, lineup, pitching availability, rosters, depth chart,
injuries, staff, prospects/development, contracts, payroll, free agents, trades,
40-man pressure, franchise history, organization comparison, trends, player
search/dossiers, draft, leaderboards, watchlist/notes, settings, storylines, and
staff chat.

Advanced statistics are derived from the imported league context. The app also
handles a number of OOTP-specific edge cases documented in code/tests, including
un-padded dates, roster-list membership, players changing levels, contract
control versus contract end, missing optional export columns, and rating-scale
display.

### Desktop and release

- Electron uses context isolation, no renderer Node integration, a small
  preload bridge, restricted local-path opening, safe external navigation, a
  single-instance lock, renderer recovery, and OS-backed secret storage when
  available.
- Updates check Pennant's own GitHub releases (named explicitly in
  `electron-builder.yml`) and require user action to download and install. No
  release has been published yet.
- `.github/workflows/ci.yml` typechecks, tests and builds every pull request and
  push to `main`. `release.yml` (a `pennant-v<version>` tag matching `package.json`) does the same
  on Linux, then builds macOS and Windows packages. macOS signing/notarization
  needs Apple secrets the repository does not hold, so the macOS release job
  cannot pass yet; Windows builds are intentionally unsigned
  ([DEVELOPMENT.md](DEVELOPMENT.md#releases)).
- Identity: product name, repository addresses and the version come from
  `server/project.ts` and `server/appInfo.ts` (D-049). The Electron `appId` is
  `com.dakotawise.pennant`, the package author is Dakota Wise, and release tags
  are `pennant-v<version>` (never upstream's `v<version>` shape). The npm `name`
  is held for compatibility because it names the desktop user-data folder; no
  data migration exists. The one development command is
  `npm run dev` (page 5173, API 5178; `scripts/devPorts.ts`).

## Implemented AI capabilities

- Optional provider layer for Anthropic, OpenAI, Gemini, OpenCode Zen, and local
  Ollama. Provider/model selection can be global or feature-specific.
- AI-generated GM briefings, trade discussion/evaluation, storylines, and staff
  chat. Background jobs and caches keep generation off the import/request path.
- Staff personas are derived from actual organization staff where available and
  have role-specific concerns rather than interchangeable chatbot costumes.
- Chat tools call the running application's API for player, roster, schedule,
  standings, payroll, contracts, free agents, roster pressure, and other facts.
- Prompts explicitly frame the save as a simulation and reject real-world model
  memory as a source of league facts.

AI is not required for the rest of the application. The current AI tools do not
yet expose all of the new philosophy, farm-operations, retention, or scouting-
history domain outputs.

## Implemented organizational philosophy

Present on `main`:

- A per-organization versioned profile persisted in local settings.
- Fifteen 0–100 preference dimensions plus explicit contract/trade policies.
- Manual, staff, and hybrid modes in the stored type/normalizer.
- A React Organizational Philosophy page and settings API for reading,
  updating, and resetting a profile.
- Philosophy consumers: preference among defensible assignments
  (`assignmentPreference.ts`), position-player and pitcher minor-league plan
  ranking, and retention scoring/pressure. Philosophy does not enter Player
  Development's authorization (D-019).
- Responses expose effective values and philosophy adjustments.

Only **manual values are implemented as an actual source**. Staff/hybrid mode
plumbing exists, but no staff-derived values are supplied, so those modes fall
back to manual values. Philosophy is not yet a universal input to contracts,
trades, free agency, or other front-office models.

## Implemented player development

Present on `main`:

- Prospect decisions separate current-level performance, sample confidence,
  age/level urgency, and observed current-to-potential maturity, against
  developmental thresholds that no philosophy can move. The organization's
  promotion aggression is applied afterwards, as a preference among the
  defensible assignments. **Changed by D-044:** age relative to
  level may RAISE the bar for a player young for it and never lowers it for one
  who is old for it, and the production diff it is measured on is league-relative
  and park-adjusted rather than level-pooled.
- Assignment plans evaluate normal promotion, exceptional skip-level promotion,
  one-level demotion, and AAA-to-MLB discussion against the organization's
  actual affiliate ladder.
- **Added by D-044:** `currentAssignment.ts` answers "is the level a player is
  at still developing him?" as two readings (level standing, developmental window)
  with a four-state verdict, distinguishing `not_assessable` (no season to read)
  from `indeterminate` (missing evidence).
- Destination fit compares visible current tools with active players in the
  actual destination league and adds stronger gates for skip-level moves.
- **Developmental stakes (D-050, [DEVELOPMENTAL_STAKES.md](DEVELOPMENTAL_STAKES.md)).** The protection tier
  answers how high the developmental stakes are if the organization mishandles a player: his
  organization-visible ceiling, read against fixed lines that stand for the weakest tenth, the median and
  the best tenth of major leaguers of his kind (the absolute anchor), lowered one step for each step by which
  the development that would realize it has run out (age; behind his level's schedule, against the rostered
  players of his own league; a projection already realized). Context may only lower it. No result, usage,
  philosophy or other player's rating is an input, and there is no score: the tier, its reasons and its two
  readings are the output. `developmentalContext.ts` is the one way a tier is computed, per request. It
  replaced an absolute composite whose cut-offs could not be reached on the adapter's scale (no core prospect in
  thirty organizations, none protected at Arizona) and which was blind to age and level. Every constant is
  provisional or policy; `npm run stakes:report` re-measures the reference. Arizona now reads 0 core, 8
  protected, 46 priority, 100 normal, 76 organizational depth.
- Defensive assignment fit uses visible fielding ratings/experience and becomes
  stricter for more protected prospects.
- **Removed by D-044:** `computeProspects`' `signal` and `score` — a
  second promotion-and-demotion verdict built from raw statistics, which ordered
  the payload as a leaderboard and which the Dashboard and the AI briefing read.
  Both now read the engine.

## Implemented Minor League Operations

Present on `main` (D-044 to D-046; design and audit in
[MINOR_LEAGUE_OPERATIONS.md](MINOR_LEAGUE_OPERATIONS.md)):

- **Production evidence** (`farmResults.ts`): each minor leaguer's line read against
  his own LEAGUE at his own level, park-adjusted, with the sample and the
  reliability it supports, and a stated reason whenever it cannot be read.
  `farmUsage.ts` reads innings by position, starts and appearances.
- **Playing time** (`playingTime.ts`): conflicts as named players competing for a
  named job with what each is getting — one man one job, competition rather than
  absence, stakes from Player Development's tier, and no share read from a club
  that has played fewer than twenty games.
- **Windowed usage and current opportunity** (D-048; `farmRecentUsage.ts`, `clubArrival.ts`,
  `farmUsage.ts` `clubGameLogs`): season usage, recent usage and current state are three kinds of
  fact. The export's per-game log (complete for every minor-league level and exact against the season
  tables) gives a recent read over the club's last fifteen games, in starts, measured only over the
  games a man could have played in — since he arrived (OOTP's transaction log first, the game log's
  bound without it), outside a recorded injury spell. A man's current level is the recent read, the
  season's when the export has no game log, and `unknown` when the window is too thin: a prospect
  four games into a new club is neither bench depth nor blocked. A man who held a job and left it
  restarts the window for everyone else and is named as history, never as a blocker; a rehab
  assignee's starts are set aside. A rotation also has an exported present (`projected_starting_pitchers`).
  Conflicts carry their `timing`; a relief window may confirm or clear a shortage and never raise one;
  a lone claimant who is not playing is read as not playing. The contract gained `currentOpportunity`.
  On the real save the farm's attention list went 19 → 10: all seven pressing blocked-prospect findings
  were a promotion wave four games before the export. `npm run farm:usage-window` re-measures the
  provisional window constants on any import.
- **Assignment review** (`farmAssignments.ts`): composes the current-assignment
  read, the opportunity read, Player Development's defensible alternatives and
  philosophy's preference among them into one of eight descriptive conclusions,
  with ownership stated per question and the GM's decision named.
- **Affiliate health** (`farmAffiliate.ts`): each club read twice — operational
  (can it field a team and cover a schedule?) and developmental (are these players
  developing?) — never merged, with structured findings carrying evidence, basis,
  what is missing and what would resolve it.
- **Organization view** (`farmOrganization.ts`): positional congestion on the
  developmental path, depth on what a man can play, and starters against the
  rotation spots each level has.
- **Cascades** (`farmCascade.ts`): a chain whose every step is independently
  defensible, stopping at absorbed / no defensible move / indeterminate /
  relocates the same shortage / the bottom of the ladder / four steps.
- **Retention** (`farmRetention.ts`): three questions with three owners —
  developmental outlook (Player Development, philosophy cannot reach it),
  operational pressure (Minor League Operations), organizational stance
  (Philosophy, a stated lean after the outlook). A decision belonging to the
  40-man, a major-league contract or an injured list is `not_a_farm_decision` and
  names the process that owns it.
- **Calibration** (`farmCalibration.ts`): every farm constant declared once and
  stamped `policy` or `provisional`; none is `calibrated`, and the reason is
  stated. `npm run farm:base-rate` reports how often the module raises something.
- **API/UI:** `GET /api/farm-operations/:orgId`, `.../consequence/:playerId` and
  `.../arrival/:playerId/:teamId` (`farmRoutes.ts`); page "Minor League Operations" (Farm System group),
  five views behind one entry, hash-addressable, sharing MLB Operations' shell and
  chip vocabulary. Read-only; not in the static export.
- **The MLB ↔ farm contract** (`farmConsequence.ts`): `mlbEvidence.farmConsequence` carries
  `farm: FarmConsequenceV2` for a departure — the vacated job, whether it can be
  absorbed, whose playing time changes, the replacements, the cascade, what is left
  open and how it was measured. Enforced statically in both directions.
- **Verified on the real Arizona save** (read-only): 230 of 230 players on an
  active list reasoned about (against 75 of 247 before), 18 attention items (11
  pressing), and fourteen findings fixed or documented (§6.2).

### Superseded and deleted

The superseded solvers (`minorLeagueMoves.ts`, `minorLeaguePitchingOperations.ts`,
`pitcherRosterSimulation.ts`, `minorLeagueRetention.ts`), their three routes
(`/api/minor-league-moves`, `/api/minor-league-retention`, `/api/minor-league-rosters`)
and the three older Farm pages were **deleted** in the hardening phase
([MINOR_LEAGUE_OPERATIONS.md](MINOR_LEAGUE_OPERATIONS.md) Part 7, D-047). Exactly one
farm implementation exists. `minorLeagueRoster.ts` is counts and coverage only (its
role-code statuses and prose lines are gone) and `rehabAssignments.ts` stays.
The Player Development pages ("Player Development", "Scouted Development") read
`/api/scouted-development/:orgId` (`scoutedDevelopment.ts`: the organization's minor
leaguers with scouted grades, protection tier and history evidence).

The scouted-development work adds a full scouting-history API and a Scouted
Development page built on observed snapshots, peer pace, rating movement, and
explicit fog-of-war language. The visible and calculated history is
organization-scoped, static exports carry the payloads, and focused regression
tests cover those boundaries.

**Hardening phase (D-047, MINOR_LEAGUE_OPERATIONS.md Part 7):** a blocker holds the job (only a
regular is one; otherwise an opportunity conflict); cover holders are named as ahead and count
against nobody's claim; a designated hitter is `bat_only`; a player injured past a week is not
cover and competes for nothing; a cascade over an unevaluated pool is `indeterminate` and says
so; retention reads an open runway before this season's line; the organization is read once per
request (`FarmSession`); MLB Operations displays the farm's own operational status before and
after a move, the v2 answer, and an arrival answer for an option; the Dashboard chip counts the
farm's attention list and the AI briefing receives the farm's structured conclusions; farm
caches are cleared on import; every share line is declared once in `farmCalibration.ts`.
Measured: ten consequences in one request 10.9 s → 1.1 s; retention indeterminates on the real
save 147 → 23; 30 organizations swept with no crash.

## Implemented evidence boundary

Present on `main` (D-017):

- `server/scoutedEvidence.ts` is the single source of ability evidence for
  Player Development and Minor League Operations. It reads the exported tool
  ratings only, builds strict composites (all tools known or none), keeps
  missing values missing, normalizes any detected OOTP display scale to 20-80,
  reports provenance and the resolved viewer organization, and returns branded
  `ScoutedAbility` values.
- `players_value` ability/talent fields are no longer read by any development or
  operations module and are never a fallback. Migrated consumers: prospect
  decisions and the depth chart (`org.ts`), `minorLeagueMoves`,
  `minorLeaguePitchingOperations`, `minorLeagueRetention`,
  `minorLeagueRoster`, `pitcherRosterSimulation`, and `destinationFit`. The four
  superseded solvers among them were later deleted (D-047).
- Decisions and protection report incomplete rating evidence and what is
  missing. Destination fit no longer reads a missing grade as zero, lists
  unassessed tools, and leaves the skip-level destination gate unknown (D-018).
- `tests/evidenceBoundary.test.ts` statically forbids guarded modules from
  regaining a direct rating source and pins the set of modules allowed to read
  `players_value`.

Unknown ratings are not imputed anywhere (D-018): readiness and protection are
`null` when the ratings they depend on are, assignments are `defensible`,
`indefensible`, or `indeterminate`, and Minor League Operations and retention
carry indeterminate results as such (`indeterminate` lists and recommendation),
never as approval, rejection, protection, or a hold. Philosophy cannot resolve
an unknown.

Not yet done: scouting snapshots use their own composite; the free-agent
surface still reads `players_value` (the player
card and Contracts stopped in Player Value phase 6a, the Trade Center in 6b, and
Org Comparison, the Roster's scouting column and the Lineup in 6d; the Roster's
rating bars still read the rating columns directly, outside the adapter); whether
`players_value.oa`/`pot` are the organization's scouted view is unknowable from
the repository; the farm workspaces do not yet render operations' indeterminate
candidates. The provenance of every rating field is tabulated in
[ARCHITECTURE.md](ARCHITECTURE.md).

## Implemented roster evidence foundation

Present on `main` (D-020 to D-022):

- **Current State** (`server/playerState.ts`): every field read from its export
  column with provenance and, when absent, an unknown reason. 40-man membership
  is `is_on_secondary` as exported; DFA/waivers and countdowns, service time,
  option counters, Rule 5 protection, injured-list flags, and major/minor
  contract are preserved as exported.
- **Save discovery** (`server/ootpSave.ts`): the `.lg` is derived from the CSV
  export's path with no configuration; a hand-picked folder
  (`POST /api/save-source`) is only a fallback. `last_date_simulated.dat` gives
  the save's simulated date.
- **Safe live-log reader** (`server/liveLogSnapshot.ts`): copies the live
  `temp/text_data.sqlite3` and its WAL to a private directory, verifies the copy
  did not move, validates it, retries, opens only the copy read-only, and
  deletes it. Tolerates OOTP running, WAL/SHM present or absent, and an
  unavailable database. Never writes to OOTP files.
- **Transaction chronology** (`server/transactionLog.ts`): structured, dated,
  attributed events for optioned, recalled, purchased contract, DFA/waivers
  (with irrevocable status), injured list, restricted list, release, Rule 5
  return, injury rehab, and level moves; unrecognised wording is kept as
  `unsupported` events. Legacy-encoded text is decoded.
- **Assignment context** (`server/assignmentContext.ts`,
  `server/playerContext.ts`): rehab assignment is first-class and is not an
  option or a demotion. A 40-man player below MLB that nothing explains is
  `unattributed` with the reason, never assumed optioned.
- **Freshness** (`server/dataFreshness.ts`, `server/dataStatus.ts`,
  `GET /api/data-status`): save, CSV, and log compared on simulated game days;
  overall `current`/`partial`/`stale`/`unavailable`.
- **`rosterStateHistory`**: demoted to observed fallback and cross-check; it
  attaches explicit log events in an interval as evidence and flags unexplained
  changes.
- **UI**: a header chip ("Roster data: Current") with a short panel, a banner
  only when the snapshot is behind the save, a rehab/optioned mark on roster
  rows, an assignment block on the player card, and assignment labels on the
  roster-crunch page. Roster crunch now counts the exported 40-man and gives a
  rehab player no option-year warnings.
- **Verified against a real save** (read-only): 15,481 log rows read in about
  100 ms, all sources current through 15 May, the 40-man is 30 as exported (the
  old inference said 35), and Merrill Kelly is a rehab assignment sent 5 May.

## Implemented player rights

Present on `main` (D-023; research in [RIGHTS_RESEARCH.md](RIGHTS_RESEARCH.md)):

- **League rules** (`server/leagueRules.ts`): option rule, DFA and waiver
  periods, active/expanded/40-man limits, read as exported. Since Player Value
  phase 1 it is the one `LeagueRules`: the contract regime (free-agency and
  arbitration lines, minimum salary, service-year length, money scale) is read
  here too, every column guarded, through `parent_league_id`; `valuation.ts`'s
  duplicate with its 6 / 3 fallback is deleted. The season it applies them in is
  the league's own `season_year` where the row states it, the regime's only
  where it does not (hardening, D-14).
- **Rights evaluator** (`server/playerRights.ts`): option, recall, add to the
  40-man, designate, outright assignment and IL activation, each
  `eligible`/`ineligible`/`indeterminate` with reasons carrying their basis
  (export, observed, documented), requirements, missing evidence and
  limitations; plus an option-year standing and a Rule 5 standing. Stale export
  makes every action indeterminate; only recall depends on the log. Contract-
  control eligibility (`evaluateContractControl`: pre-arbitration, arbitration
  trip, free agency, reserve clause, each season from a projected service band)
  joined it in Player Value phase 1 (D-052, Q-1).
- **Consumers:** `rightsFor` in `playerContext.ts`; the roster-crunch route now
  reads only `PlayerState` and rights (its Rule 5 flag, which could not fire on
  real data, is gone); the player dossier carries `rights`.
- **UI:** the 40-Man page shows the league's real limits and a "What can be
  done" chip per player; the player card has a compact "Roster rights" block.
- **Experiment tooling:** `scripts/rights-experiment.ts` (`rights:capture`,
  `rights:diff`) imports a copied save's export into an isolated database and
  diffs before/after. Captures land in the git-ignored `captures/`.
- **Established by experiment** (copied save `RIGHTS-EXP.lg`): the 5-year
  consent threshold, three option years and out-of-options refusal, the option
  charge at the first day rollover (a same-day round trip is free), no recall
  waiting period, the 7-day DFA with a 3-day claim window, outright vs option
  told apart by `is_on_secondary`, restoration of a DFA player, 10-day IL stays
  on the 40-man.

Not done, by design: rights for IL activation, Rule 5, re-optioning after the
last option year, rehab returns, claims, refusals, trades (all `indeterminate`).

## Implemented Player Value (phases 1, 2, 3a, 3b, 4a, 4b, 5a, 5b and 6a)

D-052, [PLAYER_VALUE.md](PLAYER_VALUE.md) Part 9. Present in the worktree:

- **Contract facts** (`server/playerValueContract.ts`): season-by-season salary
  for the deal and a signed extension, options by kind, buyout, opt-out count,
  incentives, the club of record for the money. A salary of 0 (every
  minor-league deal on the imported save) is unknown, never $0, and a clause
  column the export never populates (no-trade, buyout, retained) is unknown,
  never "none".
- **Control timeline** (`server/playerValueControl.ts`): for each season to the
  end of control, capped at seven (policy, Q-3), a status (`under_contract`, an
  option (club, player, vesting, mutual), `opt_out`, `pre_arbitration`,
  `arbitration`, `free_agent`, `reserve_clause`, `indeterminate` with what it lies
  between) and a cost band: the salary under contract, both branches of a future
  option or an opt-out, and since phase 4a a priced band for pre-arbitration,
  arbitration and open seasons (below). **Hardening F2 (2026-09-23):** the
  season under way is never an open option (19 were on the Arizona import); the
  58 exported opt-outs are named, and 28 seasons after one (Soto, Witt, Yamamoto,
  Bellinger and others) show both branches; the export's blank contract row (6,894
  held players) has no kind, and the 24 major leaguers on the 60-day list with one
  read their Player Rights standing; an unpopulated vesting flag is said on the
  last season. Player Rights counts arbitration trips by winter (a Super Two's next
  year is his second; 2027 for a player already in arbitration is never his first
  again), keeps a 10-day policy margin around the Super Two cutoff (owner,
  2026-09-23), gives an injured-list player the days left on his stint, and reads
  the schedule's calendar (`seasonServiceCalendars`: 187 days, 135 left on the
  import) so a short schedule never brings free agency early.
- **Entry point** (`server/playerValue.ts`): per request for the players asked
  about, or league-wide (`leaguePlayerValues`, about 0.2-0.3 s for all 12,575
  active players on the Arizona import; `npm run value:report`).
- **Consumers moved to it:** `controlAfterThisSeason` in `contracts.ts` now
  reads the timeline, so Contracts, the Payroll control column and lists, the
  Trade Center's AI context, the player card and Free Agents' "hitting the
  market" list share one answer. A status the save cannot establish shows as
  "Not yet established" (Contracts), a third Payroll list, or a count on Free
  Agents. `SERVICE_DAYS_PER_YEAR` and `serviceRemainingThisSeason` are deleted.
  Since hardening F2 an option next season reaches every consumer (and the AI
  prompts) as `option` with both branches, never "signed"; Payroll reads Player
  Value's contract facts (`payrollValuations`), so dead money is "not
  established" where `retained` is not populated (it is not on the import), club
  option money is counted apart, and the season is the league's; Contracts shows
  service as years.days; Free Agents counts option contracts as undecided.
- **Club Finances** (phase 2, `server/playerValueFinances.ts`, read by
  `playerValue.ts`: `clubFinances`, `leagueFinances`): the league's financial
  regime as `LeagueRules.finance` (through the parent league; values whose
  meaning is not established shown raw with `meaning: 'unknown'`), the club's
  budget, payroll, revenue, expenses, market, fans, cash for trades, owner
  expectation and media contracts with sources, last season from the history
  row that names it, and the revenue trend with all-zero placeholder rows read
  as unknown. The **opening price of a win** (salary above the minimum ÷ WAR
  over contracts Player Rights finds free-agency eligible this season; central
  $7.25M, band $6.57M–$9.78M, floor $4.22M–$4.33M on the Arizona import,
  labelled "opening: the imported market") and the **replacement level** per
  season (.2877 in 2024, .2933 in 2026 to date, 2025 not measured: the
  Athletics have no 2025 standings row). Computed per request (132–150 ms).
  Hardening (B-13, D-17, D-14): a season's WAR is put on this season's
  schedule's footing by the share it covered (`scheduleShareOf`), a basis on
  under a quarter of a schedule or under 20 contracts is not computed
  (`OPENING_PRICE_MINIMUMS`, policy), a league without financials shows no club
  money in dollars, and "this season" is read from the league's own row where it
  states it, so a broken parent chain leaves the regime unknown and the season
  known. The Arizona figures are unchanged.
- **Market snapshot** (`server/playerValueSnapshot.ts`): one row per save,
  league and game date in `history.db` (`value_market_snapshots`), written once
  per import from `runImport`, idempotent, never able to fail the import.
- **Route and Payroll:** `/api/club-finances/:orgId` (club, league market,
  snapshot history). Payroll's finance header reads it, with one "league price
  of a win" line, and its three lists are no longer capped at 12 rows.
  Contracts and Free Agents read Club Finances too (`financeCards`, hardening
  F2), a missing figure "unknown"; `valuation.teamFinances()` remains for the AI
  context and Storylines.
- **Expected production** (phases 3a and 3b, `server/playerValueProduction.ts`
  and `server/playerValueRatings.ts`, served as `PlayerValuation.production`):
  wins per season from this season through seven, each an 80% and a 50% band in
  the export's WAR units with its basis (seasons and weights, opportunities,
  regression share and the results/ratings weights, age adjustment, usage band,
  proneness, the ability evidence and its provenance, a prospect's arrival
  evidence, the development path's source, the fits in force). Ability comes only
  through `scoutedEvidence.ts` (the reader loads it; the pure modules take its
  types). A player with a major-league record has his rate regressed toward what
  his ratings imply, with the weights shown (a full record is effectively his
  results alone); a player without one is projected from his ratings, his
  development toward potential and how often players at his level and age reached
  the majors on this save, his low edge always including producing nothing.
  Playing time is conditional on quality (attrition explicit), so stars keep
  theirs. On the Arizona import 8,072 of 12,575 active players have a band (1,721
  from results and ratings, 6,351 from ratings alone); 4,346 unsigned players
  without a major-league line, 149 whose club is at the majors without a
  major-league line, and 8 with no ratings are `unknown`, each with its reason;
  897 of the 901 on major-league active and injured lists have a band.
- **Calibration belongs to the save** (D-053): `playerValueProductionFit.ts`
  fits the model on the save's own history and backtests it;
  `playerValueFitStore.ts` stores each fit per save in `history.db`
  (`value_production_fits`) with its run record; `runImport` refits in the
  background when a newer completed season arrives, and the gate decides
  adoption. The provisional `PRODUCTION_PRIOR` is used until then, labelled "not
  yet calibrated on this save". On the Arizona import the fit (2006–2025,
  held out 2016–2025) passed: held-out coverage as served is 81–84% (80%
  band) and 53–61% (50% band) at every horizon (CALIBRATION.md section 6). The
  rate band never narrows further out; the wins band follows expected playing
  time (owner, 2026-09-23). Each season carries target and observed coverage.
  Since phase 3b the method is `production-3b.1` (served held-out coverage
  81–85% / 53–65%; the top tenth of projected rate's central bias fell from
  +0.20–0.44 to −0.12–+0.16 wins), and a second model, the ratings model
  (`playerValueRatingsFit.ts`: the same-time ratings → rate mapping, arrival
  rates by level and age from minor-league usage lines, the development path),
  is fitted, stored and gated the same way; the development path, the ratings'
  forecast reliability and the arrival chance by potential wait on the save's
  own rating snapshots (one on this save) and use the provisional prior or the
  kind's K until then, labelled. A results refit takes about 5 s, a ratings refit
  about 1.5 s (CALIBRATION.md sections 6.1 and 6.2).
- **Hardening (2026-09-23, method `production-3h.1`;** CALIBRATION.md section
  6.3, PLAYER_VALUE.md 2.3 and Part 7): the central is the expected wins (the
  rate of the players who play is fitted apart from the chance he plays),
  playing time is read per scheduled game under a physical ceiling measured on
  the save, the band is the mixture of no playing time and the wins when he
  plays, a listed pitcher's batting is not a hitter's line, known days out move
  the central (owner, 2026-09-23) and a season lost to injury is not evidence of
  less playing time, the rest of this season is measured on this season's games.
  The gate reads subgroups and bias as fitted; the held-out seasons are projected
  by refits of the method and the model served is refit through the last
  completed season; fits are keyed by the save's identity (name and a
  fingerprint of the league's history), never through a season not completed,
  never replaced by a failing refit, and refitted in a worker thread (12 s in
  the worker, the event loop never held over 3 ms). On the Arizona import the
  method is within 5 points of both coverage targets pooled and in every
  subgroup, the pooled central within 0.05 wins, and the cohort's summed central
  within 1–10% of its own history (was 10–66% short); the gate did **not** adopt
  it (hitters and regulars over-projected at horizons 3–7 out of time, the
  2006–15 to 2016–25 era drift), so the fallback prior is in force there, labelled
  "not yet calibrated". The ratings model was adopted then (method `ratings-3b.1`;
  see hardening F4 below).
- **Option C (owner, 2026-09-23; method `production-3h.2`;** CALIBRATION.md
  section 6.3, D-053): the backtest is rolling-origin (origins from the window's
  start + 5, at most 8, each scored by the method fitted through it, a horizon
  only with 3+ origin cohorts, errors clustered by player and origin) with a
  recency half-life of 2 seasons; the tolerances are unchanged. On the Arizona
  import (origins 2011–2024) pooled coverage is within 1.1 points of both
  targets and the pooled bias −0.01 to −0.04 wins; the gate still fails, on two
  cells (hitters at horizons 5 and 6, −0.096 wins, scored from origins
  2017–2018 into 2022–2024), so the fallback prior stays in force there. The
  refit takes 20.4 s in the worker (nine production fits). Under the prior, a
  league's WAR scale is a unit (every rate term and coefficient in its unit), a
  fit never scored or mostly the prior at every horizon is labelled "not yet
  calibrated", a label names the seasons of lines when none is usable, and
  standings beside a season with no lines are not read as that season's.
- **Hardening F4, prospects (2026-09-23; ratings method `ratings-3h.1`;**
  CALIBRATION.md section 6.4, PLAYER_VALUE.md 2.3, D-053 amendment): a
  prospect's arrival chance is read for a player not yet called up at this point
  of his season (the origin season's call-ups stay in the later seasons' cases,
  in proportion to the season still to play), his chance and playing time move
  with his projected quality by the results fit's own effect located on his
  cell's players now, another market league's farm is left out of a league's
  arrival cases and any top-level league is arriving, the arrival gate also
  fails a bias beyond 10% of what happened and three clustered standard errors
  (a tightening), the arrival model served is refit through the last completed
  season, and a missing grade widens a thin record's blend across the scale. On
  the Arizona import the ratings fit **fails** that gate (the held-out chance
  12–20% low at horizons 3–6: era drift), so the provisional ratings prior is in
  force and the 6,351 players who were projected from ratings alone are
  `unknown` production, each with the gate's reason; read as if adopted, their
  summed central is 102 / 169 / 211 wins for 2027–29 (was 15 / 22 / 24).
- **Hardening F5, the arrival model under option C (owner, 2026-09-23; ratings
  method `ratings-3h.2`;** CALIBRATION.md section 6.4, D-053 amendment): the
  arrival model is scored on rolling origins (the results fit's rule, shared),
  fitted with a 2-season recency half-life, its gate errors clustered by player
  and origin, the tolerances unchanged, and measured arrivals adopted only where
  the next season could be checked. A rating snapshot is read at its own point
  of the season for the chance by potential, and an unknown production names
  its source. On the Arizona import the fit **still fails** at horizons 4–6 (the
  chance 17% low, about 7 SE; 0–3 pass) at every half-life tried, so prospects
  stay `unknown` there; as if adopted their summed central is 111 / 201 / 256 /
  258 wins for 2027–30. The ratings refit takes 4.8 s in the worker.
- **Hardening F6, the arrival model adopted horizon by horizon (owner's option
  (b), 2026-09-23; ratings method `ratings-3h.3`;** CALIBRATION.md section 6.4,
  D-053 amendment): the horizons served are a contiguous run of passing
  horizons from the rest of this season, which must reach the next season. A
  prospect's later seasons are not established (`PlayerProduction.notEstablished`),
  each with the gate's finding at its horizon. A multi-season total that
  includes one is not a number (`productionTotal`). Labels say "calibrated
  through N seasons out". The cone keeps a "Production not established" slot for each
  later season of control. The results fit's all-horizons rule is unchanged.
  On the Arizona import the ratings fit is **adopted through 3 seasons out**.
  6,351 prospects are projected for 2026–29, with summed centrals of 111 /
  201 / 256 wins for 2027–29; 2030–32 are not established.
- **Injury proneness** (`server/injuryProneness.ts`): read as an
  owner-attested known fact; 0, blank or missing is unknown. Its effects are
  measured with standard errors clustered by player and Holm's correction; on
  this save none survives (phase 3b's hitters' 95% did not), so proneness moves
  nothing here.
- **Routes:** `/api/player-value/:playerId`, `/api/player-value?ids=`,
  `/api/player-value/production-fit/:orgId` (with the ratings model in force and
  its run record since phase 3b), and `/api/player-value/:playerId/cone`
  (production joined with control for the card, `server/playerValueCone.ts`).
  Computed per request: one player about 30 ms, an organization about 65 ms,
  500 players about 80 ms; the league-wide pass about 1.3 s, used only by
  `npm run value:report` (no per-import store yet, PLAYER_VALUE.md Part 7).
  `npm run value:report` prints production bands, counts by status and source
  and the median band width per horizon.
- **The cost of controlled seasons** (phase 4a, 2026-09-23; `server/playerValueCost.ts`,
  PLAYER_VALUE.md 2.2 and 4.4, CALIBRATION.md section 8): measured on each import from
  the save's own one-year contracts, with status and class from Player Rights. A
  pre-arbitration renewal costs from the league minimum to the 90% upper bound of
  the 90th percentile of the save's renewals (Arizona: 249 renewals, $780K–$790K).
  An arbitration season costs the minimum plus its class's robust (Theil–Sen) line
  (a base and a pay per win of the two-season platform, in the import's own dollars,
  with its 10th–90th percentile spread and the line's error from a bootstrap of the
  same fit) at the platform seasons' projected production, edge against edge; only
  the provisional prior's shares carry the price of a win's band (Arizona: classes
  1–3 on 74, 51 and 47 contracts; $0.38M + $0.96M, $1.04M + $1.75M and $0.65M +
  $2.54M a platform win; least squares had read $1.04M, $1.92M and $3.54M). Every
  priced season carries a central inside its band (none chosen between statuses,
  each named). A range of trips covers each class, and the class his service puts him
  in (where the ladder reads a player of that service); an open season covers each
  status; a season that may be free agency, or a branch the player decides, is what
  he costs if held, said. A contract at the minimum is kept out of the line; a
  season whose platform reaches as low as the save's at-minimum deals in its class
  reaches the minimum, said. Below 30 contracts a class has no line of its own: the
  provisional prior (the same method on the imported contracts) widened by the range
  the save paid the class, only where the regime as read is MLB's; a league with no
  arbitration or an unread rule gets no ladder, and in a league with no arbitration
  Player Rights lists no season as possibly arbitration. Reserve-clause renewals are
  priced only from renewals observed across imports (phase 4b). The ladder is snapshotted with the market (`basis_json.costs`;
  a key written before 4a has none, and the shape changed in the review). Payroll
  shows each controlled season's band beside committed money (never in the total or
  the room), as a range of reasonable readings with the sum of centrals beside it
  (players combined as independent since the owner's decision of 2026-09-24, below), and
  the ladder's basis; Contracts shows next season's band
  (and an option's declined branch) under the flags; the card's cone shows each
  season's cost, its central and an option's declined branch. A reading without
  production (Free Agents) prices nothing. Payroll now computes production for its
  players (about 130 ms a club). Phase 4a review (2026-09-23): PLAYER_VALUE.md Part 9.
- **The measured price of a win across imports** (phase 4b, 2026-09-23;
  `server/playerValueSignings.ts` pure, `server/playerValueContractStore.ts` the third
  writer, PLAYER_VALUE.md 4.2 to 4.4, CALIBRATION.md section 9): each import (and a server start
  that finds the imported export not yet recorded) records its
  contracts in `history.db` (table `value_contract_snapshots` with `value_contract_imports`,
  keyed by the save's identity, league and game date, idempotent; every contract the
  market league's clubs hold, and unsigned players whose production is established,
  with Player Rights' standing for three seasons, expected production and next
  season's cost; about 3.2 MB an import on the Arizona save). Two consecutive imports
  are compared: each change is named for what changed and read through Player Rights
  at the earlier import (a free-agent market signing, an arbitration salary, a
  renewal, a reserve-clause renewal, an extension, a contract that moved, a
  controlled player no club holds), never given a transaction type the export does
  not carry (D-020); ambiguous changes are counted and left out. The measured price
  is the ratio of summed salary above the minimum to summed expected wins at the
  earlier import over free-agent signings, its band the signings resampled; it
  replaces the opening price only when narrower than the opening band with its
  sampling (owner Q-4), and says why either way. Observed arbitration salaries are
  scored against the band the earlier import priced and become a class reading at
  30; reserve-clause renewals price a reserve-clause season at 30; replacement is
  measured from freely acquired players at 30. Payroll's price line names the price
  in force and why and lists the price history; `/api/club-finances/:orgId/price-history`
  serves it with every observed change. **On the Arizona save** (one import,
  2026-5-16) no off-season is observed: the measured price, the awards, the
  reserve-clause cost and replacement say so, and the opening price ($7.25M, band
  $6.57M–$9.78M; with its sampling $5.95M–$11.22M) stays in force. **Reviewed
  2026-09-24** (R3, R4; PLAYER_VALUE.md Part 9): a winter is read by the calendar (an
  import after the season number moved on is inside the winter, and imports across one
  winter count one); an extension moving with a traded player and a deadline
  acquisition re-signed are never market prices; two timelines (a save that went back,
  a date imported again with different play) are never compared; recording an import
  reads only the import before it and stores the pair (`value_contract_pairs`,
  `value_contract_events`), so capture time is flat in the number of imports (2.43 s
  with 29 earlier imports, 3.65 s before). The measured price is a set of bases (per
  win projected at signing over the deal and in the first season, if he plays, and per
  win produced in the first season once completed), resampled by winter; it is compared
  with the opening band only once it holds the realized reading and covers each third
  of the free-agent class, its central is the realized reading's, and the reason names
  the unit. Measured replacement is shown, never applied. Awards are scored with their
  bands' width. Known limit: production is unknown at an import after the season number
  moved on (D-08), so a signing first seen then has only the realized reading.
- **Phase 4 owner decisions** (2026-09-24; D-052 amendment, PLAYER_VALUE.md Part 12):
  the price of a win in force, once measured, is **per win produced** (the realized
  reading's central and band; the per-projected-win readings are its check, with their
  ratio, never the price); Payroll's club range **combines players as independent**
  around the sum of centrals (`combineProjectedCosts`, `COST_COMBINATION_POLICY`), what is
  not noise (a status left open, a range of classes, may leave) at its edges, labelled
  "players combined as independent; not a calibrated interval", the edge-to-edge sum in
  its details (Arizona 2027 $16.4M–$49.0M against $15.8M–$75.8M edge to edge); an
  **arbitration salary is never below the previous season's salary** (owner-attested,
  stated by Player Rights' `arbitrationSalaryFloor`, applied to every arbitration-priced
  season where the previous salary is known, low edges chained; 526 of 2,566 arbitration
  seasons on the save move), and an observed award below it is flagged on Payroll's
  awards line; **full contract snapshots are kept only at the winters and for the latest
  import** (`pruneContractSnapshots` at capture, one transaction, a `pruned` event; every
  pair and event kept; method `signings-4b.3`), so R3's 30-import probe holds 2.9 MB of
  snapshots instead of 86.1 MB.
- **Player card production cone** (PLAYER_VALUE.md Part 8): an "Expected
  production" section draws each season's 80% and 50% bands, the expected
  path, replacement level and control, with target beside observed coverage on
  hover and focus and the calibration line; unknown production shows its
  reason and no cone. Drawn with visx, the charting library adopted in D-054
  (`src/ProductionCone.tsx`, `src/productionConeGeometry.ts`,
  `src/chartTheme.ts`). Contracts reads production too since phase 6a; the
  card's `players_value` reads were deleted in 6a. A static site export omits it.
  Hardening F2 (2026-09-23): the legend states the bands as targets, or as
  reasonable readings under the prior; the hidden table carries every figure the
  detail shows; Escape closes a season's detail before the card; near-zero wins
  print "<0.1"; a non-number draws no cone instead of blanking the app. The card
  is a modal dialog with a focus trap (`src/focusTrap.ts`, Escape, focus back to
  the opener) and fits the window at any width (`tests/playerCard.test.ts`).
- **Neutral surplus and the retention margin** (phase 5a, 2026-09-24;
  `server/playerValueSurplus.ts`, pure; PLAYER_VALUE.md 5.1): on every valuation
  that computes production and cost (`PlayerValuation.surplus`), served for the
  card by `/api/player-value/:playerId/surplus` (`playerSurplus`). Per controlled
  season within the horizon: the wins band counted, the price of a win in force
  held flat, the cost band, a replacement's minimum, the discount weight (5% a
  season, owner 2026-09-24, `SURPLUS_POLICY`), each way the season can go, and
  both views with their centrals; summed with the seasons named. The rest of this
  season counts only its part still to be played; banked wins and paid salary are
  sunk. A major-league contract's covered salary cancels in the retention margin,
  so sunk salary never favours keeping a player. Unknown seasons are named, never
  summed as zero; without dollars the value is in wins. The player card shows a
  "Value" section below the production cone (`src/ValueSection.tsx`): both views
  side by side, then season by season with the basis. No other consumer is
  migrated (phase 6).
- **The philosophy lens and the club's value of a win** (phase 5b, 2026-09-24;
  `server/playerValueLens.ts` and `server/playerValueWinValue.ts`, pure;
  PLAYER_VALUE.md 4.5 and 6.1): "our view" is the neutral value read through the
  viewing organization's philosophy at read time (`/api/player-value/:playerId/our-view`,
  `server/ourViewRoutes.ts`), every lean named with its amount, the neutral
  figures unchanged beside it; the default philosophy (the owner's configured
  one on this save) leans on nothing. The club's value of a win is points of
  playoff odds per win and its curve over the rest of the season, from the
  deadline read's odds model (`posture.ts` exports it), never dollars and never in
  the value; served on Club Finances (Payroll's line under the price of a win) and
  on the card. `playoffs.ts` now measures a division leader's cushion against its
  nearest rival (it had used the last-placed club). The card's Value section is in
  plain words with the explanations on hover (`src/Tip.tsx`, keyboard-reachable),
  our view beside the neutral figures, and the club's value of a win as context.
- **The card's header and Contracts on Player Value** (phase 6a, 2026-09-24;
  PLAYER_VALUE.md Part 8): the card's header no longer shows the Value and Talent
  percentiles or OOTP's Overall / Potential (`players_value`, D-017); it shows his
  contract in a phrase, the Value section's headline (the same totals the section is
  served) and his scouted tools now and at their ceiling through `scoutedEvidence.ts`
  (`src/PlayerHeaderValue.tsx`), with the export's game date. `server/player.ts`
  reads contract facts through the entry point (its direct `players_contract` query
  is gone). Contracts (`server/contracts.ts`, `src/pages/Contracts.tsx`) is rebuilt on
  Player Value: contract facts, what happens after this season, when control ends
  (`controlEndOf`, the cone's own reading), next season's cost and the cost path, next
  season's expected wins, contract value, the value of keeping him and our view under
  the club's philosophy, in groups (free agents, options, arbitration,
  pre-arbitration, reserve clause, not settled, short-term, long-term), sortable and
  filterable, a row opening the card and expanding to his seasons. The percentile
  recommendations (`recommendOnValue`, the 70/75 cut-offs) are deleted, the
  dashboard's "Extension candidates" chip became "Heading to arbitration", and the
  briefing and chat prompts say contracts carry no recommendation. A-20: Contracts,
  the card's header and the one-player value routes read the export's freshness
  (`freshnessCue`, `server/dataStatus.ts`) and hand it to Player Value as
  `currentState`; the page and the header say "As of <game date>" and when the
  export is behind the save or could not be checked. Free Agents keeps its
  percentiles until its own migration (`TIP_VALUE`/`TIP_TALENT` moved there).
- **The Trade Center** (phase 6b, 2026-09-24; `server/playerValueTrade.ts`, pure;
  PLAYER_VALUE.md Part 8, consumer 3): a deal is read on Player Value.
  `POST /api/trade/analyze` (`trade.ts` `analyzeTrade`) serves both sides'
  decompositions (each player's contract value and value of keeping him as the
  card serves them, his control season by season with its cost, his expected
  wins, his salary this season), each side's total and the difference between
  the sides (what comes in less what goes out) as a band with each player's
  part, players combined as independent with an open season at its edges
  (`TRADE_COMBINATION_POLICY`, the owner's Payroll rule extended; an open owner
  question); an unknown player is named and left out; our view under the
  viewing club's philosophy beside it; the clubs' value of a win as context.
  The page (`src/TradeAnalysis.tsx`) shows the two sides side by side and a bar
  around zero, weighs the deal as it is built, and carries no jargon or verdict
  word. Trade fits and the trading block order by expected wins, shown; offers
  and trade talk read the same analysis; the AI's trade context carries the
  decomposition, and the desk gives a one-line "Read", no accept-or-reject line.
  `trade.ts` and `tradingblock.ts` read no `players_value`, rating or percentile.
- **Org Comparison, the Roster's scouting column and the Lineup** (phase 6d,
  2026-09-24; PLAYER_VALUE.md Part 8, consumers 5 and 6): Org Comparison
  (`franchise.ts` `computeOrgComparison`, `src/pages/OrgComparison.tsx`) shows
  every club of the league side by side: its record, the major-league roster's
  expected wins for the rest of the season, the farm's expected wins next season
  and its top contributor, the roster's contract value, and OOTP's payroll and
  budget; each sum is its players' served figures combined as independent
  (`groupWinsOf`, `tradeValueOf`), an unknown player named and left out; no rank,
  the table sorts by any shown column, unknown last, the viewer's club
  highlighted, the export's date said. The Roster's OA→POT column is now
  "Scouted" (the scouts' tools averaged now → ceiling through
  `scoutedEvidence.ts`, "not scouted" where a tool is not graded, sorted last).
  The lineup reads its bats (the tools model on the split grades against the hand,
  the overall grades where the export has none, said) and gloves through the
  adapter; its solver is unchanged; an ungraded bat is named, never ranked.
  `api.ts`, `lineup.ts` and `franchise.ts` read no `players_value`; the direct
  allow-list is `valuation.ts`.
- **Tests:** `playerValueControl`, `playerValueCost` (the phase 4a cost bands),
  `playerValueSignings` (phase 4b: observed changes, the measured price, adoption,
  awards, reserve-clause renewals, replacement),
  `playerValueFinances`, `playerValueProduction`,
  `playerValueProductionFit`, `playerValueRatings`, `playerValueCone`,
  `contractsPage` and `playerCardHeader` (phase 6a),
  `productionCone` (geometry, render and theme tokens), `playerValueSurplus`,
  `playerValueInvariants` and `valueSection` (phase 5a), `playerValueLens` and
  `playerValueWinValue` (phase 5b), `playerValueTrade`, `tradeAnalysis`,
  `tradeCenter` and `tradingBlock` (phase 6b), `rosterScouted`, `lineupEvidence`
  and `orgComparison` (phase 6d) and `playerValueBoundary`
  (since the hardening it reads the source through the TypeScript parser, and
  each of its hardened checks was shown to catch a deliberate mutation; a known
  violation owned by another fix is listed with its finding and must still be
  there). `playerValueCrossSave` runs every entry point over synthetic saves of
  every shape in Reviewer D's matrix (`tests/syntheticSave.ts`); the gaps other
  fixes own are `it.todo` by finding ID. Since phase 4b it rolls saves over a winter
  (`advanceWinter`) and checks the observed signings end to end.

Not built: the save's own development path, the ratings' forecast reliability
and the arrival chance by potential (they fit themselves once the save's rating
snapshots allow), a lens that reads the club's value of a win (an owner question), the odds
model's wild-card route for a division leader, personality's effect on price (it moves no number
until observed signings are read against it), a per-import store (everything is computed per request; see
Part 7), and the rest of the consumer migration that deletes `players_value` reads
(phase 6: Free Agents; the card
and Contracts are done, 6a, the Trade Center, 6b, and Org Comparison, the Roster's
scouting column and the Lineup, 6d). The calibrated constants of other subsystems are
not yet fitted per save (D-053; ROADMAP). On the Arizona import 6,952 of 8,009 held players have indeterminate later
seasons because what follows a minor-league contract is not established from
the export, and 494 meet a free-agency line inside this season's projection.
Super Two follows the owner's ruling (2026-09-22): the cutoff is computed from
the export's class (469–478 days at the end of 2026 on this import), and 130
next-season answers stay `indeterminate` because the player's own range overlaps
it or he has not yet banked 86 days.

## Implemented MLB Operations (first slice)

Present on `main` (D-024; design and audit in
[MLB_OPERATIONS.md](MLB_OPERATIONS.md)):

- **Needs** (`mlbNeeds.ts`): derived from the current export only. `role_below_standard`
  (below minimum coverage floors of 5 healthy SP, 7 RP, 2 C: floors, not targets, held as data), `open_active_spot`,
  `il_return_crunch` (an injured player due back within 15 days to a full active roster), and
  a GM-posed `what_if`. Each carries causes as stated facts, an injury-days horizon
  (temporary / extended / long-term), evidence and unknowns. Nothing is persisted or inferred
  from snapshot differences.
- **Third pass (D-027, D-028, D-029):** an unknown duration is judged across temporary depth and a
  durable assignment (`resolveAcrossDurations`, result `context_dependent`); the calibration
  numbers are marked provisional; the active-roster and 40-man spots are separate constraints with
  separate clearing lists (60-day list via the new Rights action `placeOnSixtyDayIl`, indeterminate
  until measured; designation) and each candidate/return carries a visible chain; a 60-day return
  onto a full 40-man is a need. IL activation stays indeterminate until the controlled experiment
  (RIGHTS_RESEARCH §4.11) is run; `npm run rights:candidates` names the players for it.
- **Scouting department (D-031 to D-034, ROSTER_REVIEW.md):** results evidence (`resultsMetrics`, `resultsEvidence`), a two-lens
  working estimate and findings (`roleReview`), unprompted `role_holder_review` needs for the pitching staff and the
  lineup (`mlbReview`), the `replace` direction with replacement comparison and a lead replacement, cascade plans
  (`rosterScenario`, `mlbPlans`), hitters (`lineupPicture`, bat + glove by position weight, `platoon`), and a
  rubric-based staff recommendation (ACT / EXPLORE / MONITOR / HOLD).
- **Calibrated and philosophy-aware (D-035 to D-038, CALIBRATION.md):** the constants are backtested on the league's own history
  and stamped (`calibration.ts`, `scripts/calibrate.ts`); a hitter's estimate is bat (calibrated tools model + park-adjusted
  wOBA) + glove (visible grade + zone results) + running; platoon rests on rating splits (D-035); `platoon_complement` and
  `bench_coverage` needs; `shift` and `platoon` plans; bullpen leverage roles and deployment findings; and
  `staffPreference.ts` lets the club's window and season shade urgency, the bar for "recommend", tie-breaks and plan order,
  every lean shown (D-036).
- **Staff report (D-030):** `mlbReport.ts` + `roleStanding.ts` turn a packet into a briefing: situation, the role
  picture (current holders vs the player, on visible ratings with season lines as context), the read, and
  named pathways with chains and consequences; the workspace is laid out that way and the clearing
  options are wrapping cards.
- **Responses** (`mlbResponses.ts`, wired by `mlbOperations.ts`): candidates from role
  changes among active players, recalls of 40-man minor leaguers and non-40-man Triple-A
  players, each with separate verdicts from Player Development (`mlbAssignmentContext.ts`, `org.ts`
  `mlbAssignmentAssessments`, judged per contemplated assignment context: spot start, short
  bullpen, temporary depth, bench, durable; incomplete evaluations are never actionable), Player Rights (per action,
  three-valued), role fit (`evaluateDestinationFit` at the MLB club), MLB roster effect,
  Minor League Operations' affiliate scenario (`RosterHealthScenario`), contract facts and a
  philosophy annotation for valid alternatives. Groups are explained and unranked. For a
  returning injured player it groups the ways to clear a spot by transaction class (routine
  option, final-option-year, disruptive designation), each with Rights and consequences. A
  non-40-man promotion is two Rights component actions (`addToFortyMan`, `composed.promoteToActive`).
- **API/UI:** `GET /api/mlb-operations/:orgId` and `.../responses?need=`; page "MLB
  Operations" (Baseball Operations group). Read-only; not in the static export.
- **Foundation changes:** `PlayerState.position/role`, `pitchingRole.ts`, exported
  `activeLimit`, schema-tolerant `minorLeagueRoster` player columns.
- **Verified on the real Arizona save** (read-only): the one observed need is Cristian Mena's
  return; every Reno 40-man recall is `indeterminate` because that save has no live log.
- **Rehab fix:** `rehabAssignments.ts`; Minor League Operations excludes log-established rehab
  assignees from affiliate health, depth and retention and names ambiguous ones (D-026).
- **IL activation** is still `indeterminate` but states what is known; the experiment required
  is in RIGHTS_RESEARCH §4.9.
- **Not built:** performance-driven needs, bench/positional coverage beyond the floors, ways to
  clear a 40-man spot, IL-activation rules, a Minor League Operations cascade consumer,
  trades, waivers, free agency.

## Current organization resolution

Implemented behavior is distributed:

- `/api/orgs` flags the MLB team with `human_team = 1`.
- `src/App.tsx` selects a valid saved `defaultOrgId`, otherwise the human-managed
  organization, otherwise the first returned MLB club.
- The importer uses saved-default/human fallback for automatic AI generation.
- Chat and some league searches have their own human-team fallbacks.
- Most domain endpoints and pages still pass an explicit `orgId`.

There is no shared server-side organization-context resolver yet. Automatic
resolution across all organization-specific features is future work.

## Known gaps and constraints

- Player Development mechanics (readiness, assignment authorization, demotion,
  destination fit, protection, philosophy profiles), the evidence adapter and the
  whole Minor League Operations model now have direct synthetic tests. Philosophy
  normalization/persistence and organization resolution do not.
- Minor League Operations consumes the per-assignment preference object, and
  retention no longer folds a philosophy adjustment into a development score
  (D-044, D-045). The superseded solvers that carried the old philosophy-weighted
  plan costs are deleted (D-047).
- No farm constant is calibrated against outcomes: the export holds no
  minor-league history to fit against, and every one is stamped `policy` or
  `provisional`.
- Cross-affiliate Rookie-level MOVEMENT remains deferred (eligibility and
  geography between a complex league and a Dominican one are unmodelled);
  Rookie affiliates are otherwise fully covered rather than skipped.
- Development thresholds are written for 20-80 and now receive normalized
  ratings; the scale itself is detected heuristically from the data, and whether
  fielding grades share it is an unverified assumption.
- AAA-to-MLB is assessed by Player Development and consumed by MLB Operations for
  injury-driven roster problems only; direct skip-level moves to MLB remain excluded from the
  minor-league engine.
- A manual-protection input is reserved in the development model, but no user
  control persists or supplies it.
- No developmental-stakes constant is calibrated: the save holds one snapshot of ratings, so no development curve
  can be fitted. Trajectory is not read for the same reason. The line with the largest effect (a fringe
  major-league ceiling with most of his development ahead counts as having stakes) is policy and open to the owner.
- The schedule rule in the stakes model binds only in the rookie leagues on this import: in every full-season league
  the age bands already say what "behind" would (DEVELOPMENTAL_STAKES.md Part 7).
- Staff-derived philosophy values are not implemented.
- Rule 5 protection years are context in retention but do not yet affect its
  score.
- Rights that remain `indeterminate` are listed in D-023 and the roadmap (IL activation now states
  its known facts and exact unknowns).
- Contract control stays `indeterminate` where the export cannot settle it: after a minor-league contract
  (what follows, and how `rules_minor_league_fa_minimum_years` is counted, is not established), where a
  player's service range overlaps the projected Super Two cutoff or his 86 days are not yet banked, in a
  league whose regime is not MLB's, for last winter's and later winters' Super Two classes, and where a line
  falls inside this season's service projection. Pre-arbitration and arbitration costs are unknown until the price of a win exists.
- The live log lags in-session moves until the game is saved, and the original
  save's `temp/` log was absent when it was not the loaded save; the freshness
  model does not yet say so.
- The meaning of the live log's `transaction_type` codes (0 and 1) is not
  asserted, and about 5% of real log rows (signings, extensions, international
  moves, staff hires) are kept as `unsupported` events.
- `last_date_simulated.dat` is decoded from one real save. A move made after an
  export on the same in-game day cannot be detected by date.
- A player log entry outside the current and previous season is not read.
- The system proposes actions but has no OOTP transaction execution or save
  writeback.

See [ROADMAP.md](ROADMAP.md) for the planned sequence that addresses these
gaps.

## Project consolidation

[PENNANT_CONSOLIDATION.md](PENNANT_CONSOLIDATION.md) records the phase that gave the project its identity: the
legacy-reference audit, the branch/tag audit, the documentation classification and the brand-asset audit.
Outcome: user-facing surfaces say Pennant; version lineage restarts at 0.1.0 (D-049); the update feed and in-app links
name Pennant's repository; the dev server can no longer put the API and Vite on one port; upstream's release notes and
forum posts moved to `docs/upstream/`; stale screenshots, the dead `Signal` glossary entry and the old icon were
deleted; the Dashboard's attention chips now open MLB Operations and Minor League Operations first. Still owed by the
owner: vector brand masters, the Apple signing secrets, and the repository-rename decision. Decided later
(2026-09-21): the application id, the author and the `pennant-v<version>` tag convention.

## Verification surfaces

- `npx tsc --noEmit` — TypeScript validation used by release CI.
- `npm test` — Vitest regression/API suite against a synthetic temporary league.
- `npm run check:stats` — checks derived-stat centering on suitable imported
  league data.
- `npm run check:theme` — checks generated team palettes for contrast.
- `npm run build` — Vite production build.
- `npm run desktop:build` — web plus Electron server/main/preload bundle.
- `npm run dev` — the one development command (page 5173, API 5178).
- `.github/workflows/ci.yml` — the same typecheck, tests and build on every pull request.

Vitest suites share a module-level SQLite handle and therefore run serially.
Tests must continue to use synthetic temporary data, never a live OOTP save.

## Hardening phase (MLB Operations)

Recorded in [MLB_OPERATIONS_HARDENING.md](MLB_OPERATIONS_HARDENING.md); decisions D-039 to D-043.

- **Found and fixed:** the hitter tools and glove peer populations included amateur signings (12% of the pool); a concern was
  position-blind and group-relative; a platoon with no data of its own read "no issue"; a man could be the regular at two positions;
  an unseen glove made a comparison look firm; the bench knew "can stand there" but not "is a backup"; a shift could be offered beside
  an equal plain change.
- **Refined:** role standards (`roleStandards.ts`) and role-relative concern; pen-wide bullpen findings and a rotation/bullpen conflict;
  bench cover quality and functions; platoon drivers; a structured explanation on every review need; three kinds of constant stamp
  (calibrated, provisional, policy).
- **UI:** one page became five views behind one entry (Overview, Position players, Pitching staff, Bench and coverage, Decision),
  addressable by URL hash.
- **Not changed, on evidence:** the tools model (corner residuals within two standard errors), the results model, the platoon shrinkage,
  the philosophy shading (adversarial tests found no leak).
- **Base rate (30 clubs):** review-raised needs 2.2 to 0.7 per club; a lineup regular flagged on 13 of 30 clubs instead of 25.
- **Still provisional:** the typical levels behind the role floors (one 43-game snapshot), the glove weights and defensive
  stabilization (one partial season of zone ratings), the park share, steal values. Still policy: every threshold.
