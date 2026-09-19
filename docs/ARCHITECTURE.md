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
pressure never manufactures a development case. (Known gap: today the ordinary
promotion threshold is philosophy-derived, so aggression can move a player
across the eligibility line. That is documented in D-003 and is a separate
correction from the evidence boundary.) AI can explain, compare, and
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
| Scouted evidence | `scoutedEvidence.ts` is the only reader of ability ratings for development and operations judgments. It returns branded `ScoutedAbility` evidence with provenance, viewer, scale, and what is missing. | Nothing in Player Development or Minor League Operations may read a rating column or `players_value` directly; `tests/evidenceBoundary.test.ts` enforces it. |
| Player Development | `org.ts`, `prospectDecision.ts`, `prospectAssignments.ts`, `destinationFit.ts`, `developmentFit.ts`, and scouting-history functions evaluate evidence, developmental protection, legal assignments, and destination fit. | This layer determines defensibility; it does not choose transactions for the GM. |
| Organizational Philosophy | `philosophy.ts` defines organization-specific dimensions/policies; `settings.ts` persists and resolves profiles; `Philosophy.tsx` edits them. | Philosophy ranks or adjusts choices after hard baseball/development constraints. It is not player evidence. |
| Minor League Operations | `minorLeagueRoster.ts`, `minorLeagueMoves.ts`, `pitcherRosterSimulation.ts`, `minorLeaguePitchingOperations.ts`, and `minorLeagueRetention.ts` diagnose affiliate structure and propose assignment/retention responses. | Level-changing moves must already be authorized by Player Development. Outputs are read-only recommendations. |
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

### The scouted-evidence adapter

`server/scoutedEvidence.ts` is the single entry point for ability evidence in
Player Development and Minor League Operations (D-017). Callers decide *which*
players (a roster, an affiliate, a league population — objective facts) and the
adapter decides what their ratings are.

- **Approved:** the exported tool ratings (`*_ratings_overall_*` current,
  `*_ratings_talent_*` potential), stamina and pitch grades, and revealed
  fielding-position grades (`gloves.ts`: a current grade above zero is the only
  visibility signal the export offers).
- **Prohibited:** every continuous `players_value` ability/talent field. They
  are never read for a development or operations judgment and are never a
  fallback.
- **Composite:** current and potential are the unweighted mean of the visible
  tools (hitters: contact, gap, power, eye, avoid-K; pitchers: stuff, movement,
  control). It is a Front Office summary of visible tools, not OOTP's weighted,
  position-aware Overall, and it exists only when *every* tool is known.
- **Missing stays missing:** absent, non-numeric, zero, or negative grades are
  unknown. Consumers receive `null` and a `status` of `complete`, `partial`, or
  `unknown`, plus which tools are missing.
- **Scale:** ratings are normalized to 20-80 equivalents so thresholds hold on
  any OOTP display scale; the native scale is reported. See the limits below.
- **Viewer and provenance:** every result names its provenance
  (`declared_organization_visible`, `not_verifiable_from_export`) and the
  resolved viewer organization (the single `human_team = 1` club, or
  unresolved).
- **Type barrier:** `evaluateProspectDecision` and
  `evaluateDevelopmentProtection` take a `ScoutedAbility`, not numbers.

### Rating-field provenance

What the repository can and cannot establish. "Declared" means an
owner-accepted decision (D-002) names the field as the organization's scouted
evidence; the export itself proves nothing about visibility.

| Field(s) | Origin | Status |
|---|---|---|
| `players_batting.batting_ratings_overall_*`, `players_pitching.pitching_ratings_overall_*` (current tool grades) | Exported verbatim by the importer. Upstream describes ratings as "your scouts' opinions"; D-002 declares them the scouted current grade. | **Declared visible; not verifiable.** Approved. |
| `*_ratings_talent_*` (potential tool grades) | As above; the name says "talent" but D-002 treats it as the visible scouted potential. | **Declared visible; not verifiable.** Approved. |
| `pitching_ratings_misc_stamina`, `pitching_ratings_pitches_*` | Exported verbatim. Nothing separates them from the other tool grades. | **Declared with the tools; not verifiable.** Approved. |
| `players_fielding.fielding_rating_pos{n}` (current) | Exported. Checked against one in-game player card (commit `3af3aea`): the game shows a grade only where the export's current grade is above zero. | **Visible where > 0** (one observation). Approved. |
| `players_fielding.fielding_rating_pos{n}_pot` | Exported for every position, including ones the game withholds. The same commit found ceilings in the export that the game does not show. | **Not visible where current is 0.** Used only for revealed positions. Shows the export is not uniformly fogged. |
| `players_fielding.fielding_ratings_*` (range, arm, …) | Exported. | **Declared with the tools; not verifiable.** Approved via `gloves.ts`. |
| `running_ratings_speed` | Exported. Not consumed by any development judgment; stored in scouting snapshots. | **UNKNOWN.** |
| `players_value.oa`, `pot` | OOTP's printed Overall/Potential for every player in the league. The only in-repo check (commit `6ca89c8`) was made on a save a user reported at **100% scouting**, where scouted and true grades coincide, so it cannot separate them. | **UNKNOWN. Prohibited.** |
| `players_value.oa_rating`, `pot_rating` | Exactly `round(oa/5)*5` (commit `6ca89c8`). | **UNKNOWN** (derived from `oa`/`pot`). Prohibited. |
| `players_value.overall_value`, `talent_value`, `offensive_value*`, `pitching_value` | OOTP's continuous club-value figures; upstream notes playing time is baked into `overall_value`. A code comment calls `talent_value` "scouted"; nothing supports that. | **UNKNOWN. Prohibited.** |
| `leagues.avg_rating_*` | League-wide aggregates, shown as context by destination fit. Not a judgment input. | **UNKNOWN** provenance. Context only. |
| `rating_snapshots.cur`, `pot` | Derived by Front Office from the approved tool columns at import (unweighted mean, partial averages allowed, native scale). | **Derived.** Not yet routed through the adapter. |
| Viewer organization | Not encoded anywhere in the import. `teams.human_team` marks the human-managed club; `coaches.scout_*` are staff attributes with no accuracy semantics. | **Not encoded.** The adapter uses `human_team`, or reports unresolved. |
| Scouting accuracy setting | Not exported. | **UNKNOWN.** |

The rating scale is the user's OOTP display setting (20-80, 1-20, 1-10, 2-8, or
1-5). No column carries it, so `ratingScaleMax()` reads the largest grade in
four rating columns and snaps it to a known scale. That varies by save and
user configuration, and is a heuristic; whether fielding-position grades share
the tool ratings' scale is an assumption that cannot be verified.

## Development, philosophy, and operations

### Player Development owns eligibility

The prospect decision model evaluates current-level production, sample
confidence, age/level urgency, observed current-to-potential maturity, and the
actual affiliate ladder. Assignment evaluation then identifies normal,
skip-level, demotion, or MLB-discussion destinations. Destination-fit compares
observed tools with the actual destination league and gates exceptional skips.

The output is a set of defensible assignments with reasons and blockers. It is
not an instruction to move the player.

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
