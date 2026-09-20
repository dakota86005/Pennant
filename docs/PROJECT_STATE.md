# Project state

Point-in-time snapshot from repository inspection on **2026-09-19**. Verify
this document against the current worktree before relying on it; update it when
material implementation state changes.

## Repository snapshot

- Package: `ootp-front-office` version `0.27.2`.
- Inspected branch: `feature/evidence-boundary`, created from `main` at
  `a57fc63`.
- Stack: TypeScript, React 18, Vite 6, Express 4, SQLite via
  `better-sqlite3`, Electron 41, and Vitest 4.
- Validation at this snapshot: `npx tsc --noEmit` clean, `npm test` 68 files /
  624 tests passing, `npm run build` succeeds.
- `origin/feature/mlb-operations` (a linear descendant of `main`, not merged)
  holds the MLB Operations work described in its own project-state document. It
  is an integration candidate and is not part of this snapshot.

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
- AAA-to-MLB is a discussion rather than a full opportunity decision; direct
  skip-level moves to MLB are deliberately excluded from the minor-league
  engine.
- A manual-protection input is reserved in the development model, but no user
  control persists or supplies it.
- Staff-derived philosophy values are not implemented.
- Rule 5 protection years are context in retention but do not yet affect its
  score.
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
