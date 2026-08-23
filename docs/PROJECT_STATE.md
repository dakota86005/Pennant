# Project state

Point-in-time snapshot from repository inspection on **2026-08-23**. Verify
this document against the current worktree before relying on it; update it when
material implementation state changes.

## Repository snapshot

- Package: `ootp-front-office` version `0.27.2`.
- Inspected branch: `feature/mlb-operations`.
- Inspected HEAD: `91d0555` (`feat: enforce minor league cascade roster capacity`).
- Stack: TypeScript, React 18, Vite 6, Express 4, SQLite via
  `better-sqlite3`, Electron 41, and Vitest 4.
- Before this documentation work, the worktree already had uncommitted
  application changes in `server/history.ts`, `src/pages/Development.tsx`, and
  `src/styles.css`. Those changes were inspected but not modified by the
  documentation task.

The package version and latest changelog identify `0.27.2` as the release
baseline. The inspected feature branch contains substantial organizational
philosophy and farm-system work beyond that release description. Branch code
and uncommitted work should not be described as a shipped release without a
release/tag check.

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

Present on the inspected feature branch:

- A per-organization versioned profile persisted in local settings.
- Fifteen 0–100 preference dimensions plus explicit contract/trade policies.
- Manual, staff, and hybrid modes in the stored type/normalizer.
- A React Organizational Philosophy page and settings API for reading,
  updating, and resetting a profile.
- Philosophy consumers in prospect promotion thresholds, position-player and
  pitcher minor-league plan ranking, and retention scoring/pressure.
- Responses expose effective values and philosophy adjustments.

Only **manual values are implemented as an actual source**. Staff/hybrid mode
plumbing exists, but no staff-derived values are supplied, so those modes fall
back to manual values. Philosophy is not yet a universal input to contracts,
trades, free agency, or other front-office models.

## Implemented player-development and farm operations

Present on the inspected feature branch:

- Prospect decisions separate current-level performance, sample confidence,
  age/level urgency, observed current-to-potential maturity, and organization
  promotion aggression.
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
  diagnoses hitter body count/position coverage, pitcher body count, rotation,
  bullpen structure, and a positive exported affiliate-league active-roster
  limit. Zero-valued limits are explicitly unlimited; missing rules stay
  unknown.
- Position-player and pitcher operations search for small sets of moves,
  simulate source/destination effects, consume Player Development authorization
  for level changes, apply philosophy preferences, show alternatives/rejections,
  and never write transactions. A newly created or worsened roster-capacity
  overage prevents a cascade plan from being complete until an existing
  defensible assignment resolves it; release/displacement choices remain
  unresolved.
- Retention separates developmental protection, legal assignments,
  organization utility, roster pressure, transaction guardrails, observed
  development, peer-relative development, and philosophy. Release candidates
  remain advisory.
- Farm Overview, Decisions, and Affiliates React workspaces surface these
  results.

The current uncommitted application work adds a full scouting-history API and
substantially rebuilds the Scouted Development page around observed snapshots,
peer pace, rating movement, and explicit fog-of-war language. Focused follow-up
work keeps the visible and calculated history organization-scoped, includes the
new payloads in static exports, handles immature history without an empty default
view, and adds regression coverage for those boundaries. Treat all of this as
active work, not a released feature.

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

## Initial Major League Operations foundation

- `server/rosterTransactionState.ts` is the shared, schema-tolerant roster and
  transaction-state engine. It normalizes player status and league active/
  secondary roster capacity, then evaluates recall, standard option/demotion,
  and 40-man-addition state as eligible, ineligible, or indeterminate with
  corresponding-move requirements.
- `server/majorLeagueOperations.ts` consumes that shared engine for its
  read-only MLB roster context rather than reinterpreting raw OOTP flags.
- `server/transactionHistory.ts` reads explicit dated `trade_history` player
  participation and `players_injury_history` records. The import has no
  reliable general history for recalls, options/demotions, releases, DFA
  resolution, waivers, or ordinary assignments; generic messages are not used
  as a causal event feed.
- `server/rosterStateHistory.ts` records normalized roster-state snapshots in
  persistent `history.db` only after a successful import. It deduplicates a
  repeated state using the immediate predecessor's imported game date and
  canonical state hash, while retaining distinct states from the same OOTP
  date. It compares successive observations into complete, factual player
  transitions (including appearance/disappearance) and stores causal
  correlation separately.
- Transition provenance is `observed`; imported trade/injury rows are
  `explicit`; only a matching trade organization change or injury-backed
  IL/IL-60 entry is `corroborated`. Options, recalls, releases, ordinary
  assignments, DFA/waiver resolution, and uncorroborated changes retain an
  `unknown` cause. No timeline is reconstructed before Front Office's first
  snapshot.
- `majorLeagueReactiveNeeds` is the initial MLB decision layer. It derives
  current, unresolved active-roster-capacity and basic role-coverage needs from
  current normalized state plus observed roster events. Historical losses are
  revalidated on every read, have stable incident identities, and are omitted
  when current active coverage resolves them. Trade departures are structural;
  injury-backed IL entries retain exported duration when available and otherwise
  remain duration-unknown; unsupported availability losses retain unknown cause.
- `server/majorLeagueResponders.ts` assembles unranked internal responders for
  one open role need, separately listing active-MLB coverage alternatives and
  minor-league call-up discussion candidates. It uses primary/current pitcher
  role or visible current fielding ratings for role-fit evidence, excludes
  unavailable players through shared roster state, and retains 40-man state as
  transaction context rather than filtering on it.
- `mlbDiscussionDevelopmentGates` adapts the existing Player Development
  AAA→MLB discussion evaluation. Developmentally prohibited evaluated prospects
  are excluded; available AAA depth without an applicable prospect assessment
  remains explicitly not-developmentally-evaluated rather than being silently
  excluded by prospect status. AA-and-lower direct MLB discussion remains
  unsupported and excluded.
- `server/majorLeagueTransactionPlan.ts` describes the read-only technical path
  for one selected responder and one open need. Active MLB responders receive
  internal-reassignment paths with an explicit possible role consequence.
  Minor-league responders compose `evaluateRosterAction('recall')` into
  feasible, feasible-with-corresponding-decisions, ineligible, or
  indeterminate paths. Full active/40-man rosters produce player-unselected
  corresponding decisions; logical step order is not claimed as complete CBA
  sequencing.
- `server/majorLeagueOrganizationalConsequences.ts` aggregates one selected
  transaction solution’s facts without comparing it to another. Active MLB
  reassignments retain their immediate prior-role consequence. For a
  minor-league recall, `minorLeagueConsequences.ts` invokes a read-only source
  affiliate removal scenario using the shared farm roster-health coverage,
  rotation, and bullpen rules while excluding objectively unavailable
  teammates. Player removal, coverage after removal, and an actual operational
  deficiency are separate results.
- A resulting source-affiliate problem belongs to Minor League Operations. Its
  bounded planner may return multiple complete, partial, or truncated cascade
  plans while choosing no transaction and altering no imported assignment.
  Corresponding MLB roster-space decisions remain unresolved.
- `server/minorLeagueCascadePlanner.ts` now provides the shared, bounded,
  read-only organizational assignment search for normal farm operations and
  MLB-originated recall consequences. It evaluates hypothetical assignments
  through the same affiliate roster-health model, distinguishes baseline farm
  flaws from new/worsened scenario consequences, retains multiple deterministic
  complete or partial plans, and reports indeterminate or truncated searches.
  It is bounded to three moves, 160 states, 24 actions per state, and eight
  plans, with canonical state deduplication and no repeated player movement.
- Every level-changing hypothetical move consumes existing Player Development
  assignment authorization and retains its evidence. Persisted philosophy
  preference is limited to `promotionAggressiveness`, `versatility`, and
  `rosterDepth` among defensible plans; no continuous `players_value` fields
  are used by the cascade planner. Current routes still take an explicit
  organization ID because shared server-side organization resolution remains
  future work.
- `server/majorLeagueRoleSuitability.ts` describes an admitted responder with
  visible current batting/pitching/fielding ratings, handedness,
  speed/stamina/repertoire, and objective current-level performance. It retains
  structured offense, defense, versatility, and pitching evidence rather than
  creating a single MLB-fit score. Missing evidence can make comparison
  limited or insufficient.
- `server/majorLeagueSolutionSynthesis.ts` constructs one causal solution
  variant per responder and specific retained farm plan. It classifies factual
  completeness before applying the persisted organization philosophy, keeps
  transaction decisions and cascade uncertainty explicit, and compares
  variants through structured non-dominance. It permits ties and conditional
  or cannot-responsibly-compare outcomes; stable ID order is non-preferential.
- MLB-level philosophy currently consumes `competitiveWindow`,
  `riskTolerance`, `promotionAggressiveness`, `upsidePreference`,
  `defenseEmphasis`, `pitchingDepth`, `rosterDepth`, and `versatility`.
  Minor League Operations' plan preference is carried as delegated evidence
  without re-scoring its assignments.
- `server/majorLeagueOperationsRoutes.ts` exposes the existing read-only
  reactive-need report at `GET /api/mlb-operations/:orgId/needs` and validates
  an open stable need ID before exposing its Phase 5 comparison at `GET
  /api/mlb-operations/:orgId/needs/:needId/solutions`. The list route adds
  only a compact count of defensible internal responders for queue scanning;
  it does not move decision logic into the API or UI.
- `src/pages/MajorLeagueOperations.tsx` is a dedicated Front Office
  inbox-style workspace. The current-need queue preserves selection while a
  reading pane presents complete variants, distinct responder/farm paths,
  transaction mechanics, unresolved GM roster decisions, visible role evidence,
  Player Development evidence, farm cascades, uncertainty, and Philosophy
  interpretation. Facts and interpretations are shown separately; tier ties
  are not assigned a false numeric rank. The Dashboard is unchanged.
- Phase 5B deliberately does not perform proactive upgrade detection, choose
  an outgoing active/40-man player, solve injury-return/demotion lifecycle,
  call AI, execute transactions, or write to OOTP.
- Continuous `players_value` fields are explicitly excluded from this
  subsystem's subjective evaluation because their organization-visible
  provenance is unverified. A source-backed audit is required to change that
  boundary.

## Known gaps and constraints

- Dedicated coverage for the new philosophy/development/operations modules is
  still incomplete. Scouted Development now has focused history, presentation,
  and static-export regression tests; broader philosophy and operations
  boundaries still need the coverage described in the roadmap.
- Some newer development and coverage thresholds assume a 20–80 scouting scale,
  while other parts of the app detect and display alternate OOTP scales.
- Rookie-level ACL/DSL movement is explicitly deferred until eligibility and
  environment rules are modeled.
- Player Development still supplies an AAA-to-MLB discussion gate rather than
  a lower-level direct-to-MLB gate. Phase 5 compares only responders admitted
  through that boundary; direct lower-level MLB moves remain excluded.
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
