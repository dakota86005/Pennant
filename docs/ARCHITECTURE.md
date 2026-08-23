# Architecture

This document describes the architecture present in the repository and the
boundaries new work must preserve. See [PROJECT_STATE.md](PROJECT_STATE.md) for
a point-in-time implementation inventory and [ROADMAP.md](ROADMAP.md) for work
that does not exist yet.

## Product model

Front Office is a local companion for an Out of the Park Baseball save. Its
primary product goal is to make the user feel like they are actually running a
baseball organization as the GM. The application should surface the work,
tradeoffs, uncertainty, and competing voices of a front office; it should not
collapse that experience into a generic chatbot that announces an answer.

The decision boundary is:

```text
objective save facts + observed scouting evidence
                    |
                    v
        Player Development constraints
       (which assignments are defensible?)
                    |
                    v
     Minor League Operations candidate set
       + roster/coverage/transaction needs
       + Organizational Philosophy preferences
                    |
                    v
       explained options and recommendations
                    |
                    v
             user/GM decides
```

Organizational Philosophy never makes an indefensible move defensible. Roster
pressure never manufactures a development case. AI can explain, compare, and
surface these results, but it must not replace the domain models or the GM.

## Runtime topology

```text
OOTP CSV export
      |
      v
schema-tolerant importer ---> data/league.db (replaceable imported snapshot)
      |                                  |
      |                                  v
      +--------------------------> Express API (`server/`)
                                           |
                         +-----------------+-----------------+
                         |                                   |
                         v                                   v
                 React/Vite UI (`src/`)          AI tool calls to the same API
                         |
              +----------+----------+
              |                     |
              v                     v
       browser development    Electron shell (`electron/`)

imports ---> data/history.db (persistent scouting snapshots, notes/watchlist)
```

The desktop application embeds the Express server on a local port and loads the
same built React application that a browser uses. Electron is a shell, not a
second application implementation.

## Data and persistence

### Imported league database

`server/importer.ts` reads every CSV in the selected OOTP export and creates one
SQLite table per file, using the exported header as the schema. It detects CSV
delimiter and encoding, yields between write chunks, and builds discovered
indexes. `server/db.ts` supplies table/column discovery helpers because OOTP
export shapes vary.

`league.db` is a replaceable view of the latest export, not a checked-in source
asset. Domain queries should tolerate absent tables and renamed/absent columns
where practical instead of assuming one developer's save shape.

### Persistent local state

`server/history.ts` keeps scouting-rating snapshots and user-owned state in a
separate `history.db`, so a re-import cannot erase development history. Settings,
credentials, chat history, AI caches, import metadata, and the selected save
also live under `DATA_DIR`.

From source, `DATA_DIR` defaults to `./data`. In the packaged desktop app,
`electron/main.ts` sets it to Electron's OS user-data directory before loading
server modules. These files are private runtime state and must not be committed.

Credentials come from provider environment variables or local credential
storage. Electron uses OS-backed `safeStorage` when available; source mode can
fall back to a permission-restricted local file. Secrets must never enter logs,
fixtures, static exports, screenshots, or documentation.

### Static export

`server/exporter.ts` produces a read-only website snapshot. Features that need
the server or writable state are omitted. A static export is a publishing
artifact, not an alternative application backend.

## Subsystem responsibilities

| Subsystem | Current responsibility | Boundary |
|---|---|---|
| Import and save discovery | `server/paths.ts`, `importer.ts`, `watcher.ts`, and `api.ts` find OOTP 27 saves, import CSVs, report progress, and refresh on new exports. | Do not parse or mutate binary OOTP saves. |
| Database compatibility | `server/db.ts` discovers available tables and columns; query modules adapt to export differences. | Do not hard-code a single save's schema without a guarded fallback. |
| Domain API | Express routers in `server/*.ts` compute rosters, player dossiers, standings, schedules, stats, contracts, payroll, trades, development, and other front-office reads. | Domain logic belongs here, not duplicated in React or AI prompts. |
| Player Development | `org.ts`, `prospectDecision.ts`, `prospectAssignments.ts`, `destinationFit.ts`, `developmentFit.ts`, and scouting-history functions evaluate evidence, developmental protection, legal assignments, and destination fit. | This layer determines defensibility; it does not choose transactions for the GM. |
| Organizational Philosophy | `philosophy.ts` defines organization-specific dimensions/policies; `settings.ts` persists and resolves profiles; `Philosophy.tsx` edits them. | Philosophy ranks or adjusts choices after hard baseball/development constraints. It is not player evidence. |
| Minor League Operations | `minorLeagueRoster.ts`, `minorLeagueMoves.ts`, `pitcherRosterSimulation.ts`, `minorLeaguePitchingOperations.ts`, and `minorLeagueRetention.ts` diagnose affiliate structure and propose assignment/retention responses. | Level-changing moves must already be authorized by Player Development. Outputs are read-only recommendations. |
| Roster & Transaction State | `rosterTransactionState.ts` normalizes imported roster/transaction facts and evaluates limited recall, option, and 40-man-addition rule state. `transactionHistory.ts` reads explicit trade and injury event records. | It returns eligible, ineligible, or indeterminate results plus corresponding-move requirements. It does not choose players, simulate transactions, or infer events from changed current state. |
| Major League Operations | `majorLeagueOperations.ts` consumes shared roster/transaction context for MLB workflows. | It separates known facts from transaction unknowns; it does not judge readiness, detect needs, rank candidates, simulate transactions, or write to OOTP. |
| AI features | `providers.ts`, `models.ts`, `chat.ts`, `ai.ts`, and `storylines.ts` provide staff chat, briefings, trade discussion, and storylines through configurable providers. | AI consumes computed save-grounded facts, calls the same API as the UI, and supports the front-office experience. It does not become a parallel recommendation engine. |
| Web UI | React pages in `src/` render domain results, evidence, alternatives, and local interactions. `src/App.tsx` owns selected-save and selected-organization UI context. | React may shape presentation but should not silently reimplement baseball rules. |
| Desktop shell | `electron/main.ts`, `preload.ts`, and `updater.ts` embed the local server, expose a minimal IPC bridge, protect navigation, store secrets, and manage consent-first updates. | Keep Node access out of the renderer and keep IPC narrow. |
| Tests and checks | Vitest uses a hand-built temporary league; release CI runs type-checking and tests. Manual stat/theme checks use real imported data. | Fixtures must be synthetic and contain no live-save or private data. |

## Evidence and fog of war

The application has two evidence classes.

### Objective save facts

Statistics, contracts, salary commitments, service time, injuries, roster and
transaction status, age, schedule/results, and recorded transactions may be
treated as known when their required export fields exist. Derived metrics must
remain traceable to those facts and label missing or small-sample evidence.

### Subjective player judgments

Ability, ceiling, readiness, role quality, and developmental trajectory must be
based on information available to the organization:

- exported current and potential scouting ratings (including OOTP columns whose
  names contain `talent` but represent the visible scouted potential grade);
- the organization's/scouting director's persisted rating observations;
- development history derived from those observations; and
- objective performance/context used as evidence, not as omniscience.

Do not query or infer hidden OOTP true-talent values. A missing or withheld
grade must remain unknown; do not replace it with a league lookup, another
organization's view, or a confident AI guess. Rating movement means the
organization's observed evaluation changed; it may reflect development,
scouting revision, or both.

`players_value` also exports continuous `*_value` figures, including
`overall_value`, `talent_value`, offensive splits, and `pitching_value`. Their
export provenance does not establish that they are organization-visible
scouting information. Until a source-level audit establishes that provenance,
Major League Operations must not use them for player evaluation, readiness,
role fit, candidate ordering, or recommendation. Their absence is not a zero
value. This restriction does not alter use of separately validated visible
`oa`/`pot` grades or component scouting ratings.

## Development, philosophy, and operations

### Player Development owns eligibility

The prospect decision model evaluates current-level production, sample
confidence, age/level urgency, observed current-to-potential maturity, and the
actual affiliate ladder. Assignment evaluation then identifies normal,
skip-level, demotion, or MLB-discussion destinations. Destination-fit compares
observed tools with the actual destination league and gates exceptional skips.

The output is a set of defensible assignments with reasons and blockers. It is
not an instruction to move the player.

### Major League Operations owns MLB context, not player readiness

`majorLeagueOperations.ts` consumes `rosterTransactionState.ts` for imported
active/secondary roster status, health, service-time context, and raw
transaction-status facts. The shared engine owns current-state interpretation
and the limited recall, option, and 40-man-addition action answers. It returns
known facts separately from missing or incompletely derivable transaction
facts, including corresponding-move requirements. It does not detect needs,
rank candidates, recommend a call-up, simulate a transaction, or write to
OOTP. A future MLB opportunity workflow must consume Player Development's
defensible AAA-to-MLB discussion set rather than treating a roster opening as
evidence of readiness.

The importer has explicit `trade_history` and `players_injury_history` tables
when OOTP exports them. `transactionHistory.ts` reads these as dated trade
participation and injury events. `messages` includes dated, typed notices but
is not a reliable general transaction log because its message-type semantics do
not establish a stable event taxonomy. No explicit exported history currently
establishes recalls, options/demotions, DFA resolution, waivers, releases, or
ordinary assignment changes; those must remain unknown rather than inferred
from current roster state.

### Organizational Philosophy owns preferences

Philosophy profiles are stored per OOTP organization. The current profile has
manual values and policies; the persisted shape anticipates staff and hybrid
modes, but staff-derived values are not implemented. Philosophy may change a
threshold owned by the development policy (for example promotion aggression)
or rank already-legal operational alternatives. It may not override hard
guardrails, fabricate evidence, or conceal why a result changed.

### Minor League Operations owns constrained roster solutions

Operations reads the real affiliate tree and active rosters, diagnoses body
counts, defensive coverage, rotations, and bullpens, and searches for small
sets of moves that improve a destination without making the source unhealthy.
Same-level balancing has development-protection rules. Promotions/demotions
must come from Player Development's eligible set. Philosophy adjusts the cost
of viable alternatives, and the response exposes those adjustments.

Retention similarly separates developmental value, organizational utility,
roster pressure, transaction guardrails, and observed development. A release
candidate is an advisory flag for GM review, never an automatic transaction.

## Organization context

The current UI loads `/api/orgs` and chooses, in order, a saved default
organization, the OOTP team marked `human_team = 1`, then the first MLB club.
Several server/AI fallbacks also query `human_team = 1`. Most domain routes
still require `:orgId`, so organization resolution is not yet centralized.

New organization-specific features should accept/reuse established context
and automatically resolve the configured or human-managed organization when
possible. Raw IDs are useful API identifiers, but should not become routine
user input. A shared server-side resolver is roadmap work; do not claim it
already exists.

## API and AI boundary

`server/api.ts` composes feature routers under `/api`. The React UI calls those
routes through `src/api.ts`. Chat tools deliberately call the running app's own
HTTP endpoints, which keeps calculations consistent with the pages.

AI output must be grounded in returned data, state uncertainty, and respect the
speaker's organizational role. Domain recommendations should be computed in
deterministic TypeScript/SQL first; AI may explain or discuss them. Provider
calls are optional and the non-AI application must continue to work without a
credential.

## Safety boundaries

- The server binds to loopback by default and validates the `Host` header to
  mitigate DNS rebinding. LAN mode has no authentication and must remain an
  explicit user choice.
- Electron disables renderer Node integration, enables context isolation,
  filters external navigation, and restricts path-opening IPC to `DATA_DIR`.
- Updates are consent-first: checking may be automatic, but download/install is
  user controlled.
- The current product reads OOTP exports and proposes actions. It does not
  perform transactions in OOTP or write to the save.
