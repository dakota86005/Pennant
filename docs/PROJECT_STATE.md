# Project state

Point-in-time snapshot from repository inspection on **2026-09-19**. Verify
this document against the current worktree before relying on it; update it when
material implementation state changes.

## Repository snapshot

- Package: `ootp-front-office` version `0.27.2`.
- Inspected branch: `feature/mlb-operations-v2`, created from `feature/player-rights`
  (Player State foundation merged as PR #2 and Player Rights as PR #3; this branch is three commits ahead of `main`:
  the MLB Operations rebuild, the scouting-department layer, and the hardening phase).
- Stack: TypeScript, React 18, Vite 6, Express 4, SQLite via
  `better-sqlite3`, Electron 41, and Vitest 4.
- Validation at this snapshot (after the hardening phase): `npx tsc --noEmit` clean, `npm test` 118 files /
  1396 tests passing, `npm run build` succeeds. 159 of those tests are the behavioral corpus
  ([BEHAVIOR_CASES.md](BEHAVIOR_CASES.md)).
- `origin/feature/mlb-operations` is **not merged** and was audited end to end
  ([MLB_OPERATIONS.md](MLB_OPERATIONS.md) §2). `rosterStateHistory.ts` and
  `transactionHistory.ts` were ported earlier in adapted form; `rosterTransactionState.ts`
  is superseded and removed from consideration; the rest was replaced, modified or deferred
  per component. The current MLB Operations slice is on `feature/mlb-operations-v2`.

The package version and latest changelog identify `0.27.2` as the release
baseline. `main` contains substantial organizational philosophy, farm-system,
and scouted-development work beyond that release description. Branch code should
not be described as a shipped release without a release/tag check.

## Existing documentation and agent configuration

Before the durable documents linked below were added:

- `README.md` was the only broad product/technical guide. It includes install,
  workflow, AI setup, troubleshooting, release instructions, a short “How it
  works” section, project layout, statistics notes, and limitations.
- `docs/` contained committed screenshots, an icon, and screenshot publishing
  instructions, but no architecture, decisions, roadmap, or state document.
- `.claude/launch.json` contained a single `npm run dev` launch configuration.
- `.agents/` and `.codex/` contained no files.
- There was no top-level `AGENTS.md` or other durable AI-agent instruction file.

The new documentation extends rather than replaces the README:

- `AGENTS.md` is the concise agent entry point.
- `ARCHITECTURE.md` records boundaries and subsystem ownership.
- `DECISIONS.md` records durable product/technical choices.
- `ROADMAP.md` separates present foundations from future work.
- This file records the point-in-time implementation state.

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
- Updates check against GitHub releases and require user action to download and
  install.
- Release CI type-checks and tests on Linux, then builds macOS and Windows
  packages. macOS signing/notarization is conditional on configured secrets;
  Windows builds are intentionally unsigned in the current configuration.

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

## Implemented player-development and farm operations

Present on `main`:

- Prospect decisions separate current-level performance, sample confidence,
  age/level urgency, and observed current-to-potential maturity, against
  developmental thresholds that no philosophy can move. The organization's
  promotion aggression is applied afterwards, as a preference among the
  defensible assignments.
- Assignment plans evaluate normal promotion, exceptional skip-level promotion,
  one-level demotion, and AAA-to-MLB discussion against the organization's
  actual affiliate ladder.
- Destination fit compares visible current tools with active players in the
  actual destination league and adds stronger gates for skip-level moves.
- Development protection scores visible current/potential grades and age; it
  protects higher-value prospects from routine roster balancing.
- Defensive assignment fit uses visible fielding ratings/experience and becomes
  stricter for more protected prospects.
- Affiliate health reads the actual affiliate tree and active rosters, then
  diagnoses hitter body count/position coverage and pitcher body count,
  rotation, and bullpen structure.
- Position-player and pitcher operations search for small sets of moves,
  simulate source/destination effects, consume Player Development authorization
  for level changes, apply philosophy preferences, show alternatives/rejections,
  and never write transactions.
- Retention separates developmental protection, legal assignments,
  organization utility, roster pressure, transaction guardrails, observed
  development, peer-relative development, and philosophy. Release candidates
  remain advisory.
- Farm Overview, Decisions, and Affiliates React workspaces surface these
  results.

The scouted-development work adds a full scouting-history API and a Scouted
Development page built on observed snapshots, peer pace, rating movement, and
explicit fog-of-war language. The visible and calculated history is
organization-scoped, static exports carry the payloads, and focused regression
tests cover those boundaries.

## Implemented evidence boundary

Present on this branch (D-017):

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
  `minorLeagueRoster`, `pitcherRosterSimulation`, and `destinationFit`.
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

Present on this branch (D-020 to D-022):

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

Present on this branch (D-023; research in [RIGHTS_RESEARCH.md](RIGHTS_RESEARCH.md)):

- **League rules** (`server/leagueRules.ts`): option rule, DFA and waiver
  periods, active/expanded/40-man limits, read as exported.
- **Rights evaluator** (`server/playerRights.ts`): option, recall, add to the
  40-man, designate, outright assignment and IL activation, each
  `eligible`/`ineligible`/`indeterminate` with reasons carrying their basis
  (export, observed, documented), requirements, missing evidence and
  limitations; plus an option-year standing and a Rule 5 standing. Stale export
  makes every action indeterminate; only recall depends on the log.
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

## Implemented MLB Operations (first slice)

Present on `feature/mlb-operations-v2` (D-024; design and audit in
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
  Operations" (Front Office group). Read-only; not in the static export.
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
  destination fit, protection, philosophy profiles) and the evidence adapter now
  have direct synthetic tests. Roster simulation, plan ranking, retention
  guardrails, and organization resolution do not, and the farm modules assume
  export columns the shared fixture lacks.
- Operations does not yet consume the per-assignment preference object; it ranks
  with its own philosophy-weighted costs among defensible candidates. Retention
  folds a philosophy adjustment into the development score behind
  release-candidate thresholds.
- Development thresholds are written for 20-80 and now receive normalized
  ratings; the scale itself is detected heuristically from the data, and whether
  fielding grades share it is an unverified assumption.
- Rookie-level ACL/DSL movement is explicitly deferred until eligibility and
  environment rules are modeled.
- AAA-to-MLB is assessed by Player Development and consumed by MLB Operations for
  injury-driven roster problems only; direct skip-level moves to MLB remain excluded from the
  minor-league engine.
- A manual-protection input is reserved in the development model, but no user
  control persists or supplies it.
- Staff-derived philosophy values are not implemented.
- Rule 5 protection years are context in retention but do not yet affect its
  score.
- Rights that remain `indeterminate` are listed in D-023 and the roadmap (IL activation now states
  its known facts and exact unknowns).
  `minorLeagueRetention.ts` still reads a few raw roster flags for its own
  guardrails; those defer to "needs MLB transaction analysis" and draw no rights
  conclusion, so they were left as is.
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
- The README's AI-provider prose predates local Ollama support and should be
  reconciled in a future user-documentation pass.

See [ROADMAP.md](ROADMAP.md) for the planned sequence that addresses these
gaps.

## Verification surfaces

- `npx tsc --noEmit` — TypeScript validation used by release CI.
- `npm test` — Vitest regression/API suite against a synthetic temporary league.
- `npm run check:stats` — checks derived-stat centering on suitable imported
  league data.
- `npm run check:theme` — checks generated team palettes for contrast.
- `npm run build` — Vite production build.
- `npm run desktop:build` — web plus Electron server/main/preload bundle.

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
