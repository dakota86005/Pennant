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

Not yet done: scouting snapshots use their own composite; trade, contract,
franchise, roster, and player-card surfaces still read `players_value`; whether
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
  duplicate with its 6 / 3 fallback is deleted.
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

## Implemented Player Value (phase 1)

D-052, [PLAYER_VALUE.md](PLAYER_VALUE.md) Part 9. Present in the worktree:

- **Contract facts** (`server/playerValueContract.ts`): season-by-season salary
  for the deal and a signed extension, options by kind, buyout, opt-out count,
  incentives, the club of record for the money. A salary of 0 (every
  minor-league deal on the imported save) is unknown, never $0, and a clause
  column the export never populates (no-trade, buyout, retained) is unknown,
  never "none".
- **Control timeline** (`server/playerValueControl.ts`): for each season to the
  end of control, capped at seven (policy, Q-3), a status (`under_contract`, an
  option, `pre_arbitration`, `arbitration`, `free_agent`, `reserve_clause`,
  `indeterminate` with what it lies between) and a cost band: the salary under
  contract, both branches of an option, and `unknown` ("pending price of a win
  (phase 2/4)") for pre-arbitration and arbitration seasons.
- **Entry point** (`server/playerValue.ts`): per request for the players asked
  about, or league-wide (`leaguePlayerValues`, about 0.2-0.3 s for all 12,575
  active players on the Arizona import; `npm run value:report`).
- **Consumers moved to it:** `controlAfterThisSeason` in `contracts.ts` now
  reads the timeline, so Contracts, the Payroll control column and lists, the
  Trade Center's AI context, the player card and Free Agents' "hitting the
  market" list share one answer. A status the save cannot establish shows as
  "Not yet established" (Contracts), a third Payroll list, or a count on Free
  Agents. `SERVICE_DAYS_PER_YEAR` and `serviceRemainingThisSeason` are deleted.
- **Tests:** `playerValueControl`, `playerValueCost` (phase-2 halves as
  `it.todo`) and `playerValueBoundary`.

Not built: expected production, club finances, the price of a win, surplus,
the philosophy lens (phases 2 to 5), the per-import market snapshot, a cache
(the league-wide pass is computed per request; see Part 7), and the consumer
migration that deletes `players_value` reads and the percentile advice (phase
6). On the Arizona import 6,952 of 8,009 held players have indeterminate later
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
