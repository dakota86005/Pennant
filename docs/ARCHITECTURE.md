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

imports ---> data/history.db (persistent scouting and roster-state snapshots, notes/watchlist)
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
separate `history.db`, and `server/rosterStateHistory.ts` keeps normalized
roster-state snapshots and observed transitions there as well. A re-import
therefore cannot erase either observation history. Settings,
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
| Minor League Operations | `minorLeagueRoster.ts`, `minorLeagueCascadePlanner.ts`, `minorLeagueConsequences.ts`, `minorLeagueMoves.ts`, `pitcherRosterSimulation.ts`, `minorLeaguePitchingOperations.ts`, and `minorLeagueRetention.ts` diagnose affiliate structure and propose assignment/retention responses. | The shared cascade planner evaluates bounded, read-only assignment states for normal farm issues and MLB-originated perturbations. Level-changing moves must already be authorized by Player Development; no plan writes assignments or OOTP state. |
| Roster & Transaction State | `rosterTransactionState.ts` normalizes imported roster/transaction facts and evaluates limited recall, option, and 40-man-addition rule state. `transactionHistory.ts` reads explicit trade and injury event records. `rosterStateHistory.ts` persists successive normalized observations and their factual differences. | It returns eligible, ineligible, or indeterminate results plus corresponding-move requirements. Snapshot transitions are observed facts, while causal correlation is separately evidence-bound; neither chooses players, simulates transactions, or invents events. |
| Major League Operations | `majorLeagueOperations.ts` derives current reactive MLB needs, `majorLeagueResponders.ts` assembles legitimate responders, `majorLeagueTransactionPlan.ts` describes one path, `majorLeagueOrganizationalConsequences.ts` aggregates its consequences, `majorLeagueRoleSuitability.ts` describes visible role evidence, and `majorLeagueSolutionSynthesis.ts` constructs and compares complete variants. | Player Development, the transaction engine, and Minor League Operations remain authoritative for their outputs. MLB-level philosophy may compare already-defensible variants but cannot revive a veto, hide an unresolved decision, re-score a farm assignment, choose the GM's transaction, or write to OOTP. |
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
OOTP. The MLB solution workflow consumes Player Development's
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

### Persistent roster-state history and causality

After a successful CSV import, `api.ts` asks `rosterStateHistory.ts` to capture
the normalized state supplied by `rosterTransactionState.ts`. Page reads and
other API requests never create a roster-history observation. The durable
records are scoped by the configured save name and contain player organization,
team/level, position/role, active and 40-man status, IL/IL-60, DFA, waivers,
major-league contract state, and explicit unknowns.

Deduplication compares the immediately preceding snapshot's imported MLB game
date and canonical roster-state hash. A repeated import of the same state is
ignored; a different state on the same OOTP date is retained, as is a later
game-date observation with unchanged roster state. The comparison produces one
complete observed transition per affected player (including appearance and
disappearance), preserving simultaneous changes rather than naming a presumed
transaction.

`trade_history` may corroborate an organization change only when its dated,
player-specific record falls in the observed game-date interval and names both
organizations. `players_injury_history` may corroborate an IL/IL-60 entry only
when a matching injury record falls in that interval. Evidence is retained as
explicit source data; the supported causal conclusion is `corroborated`.
All other causes remain `unknown`. The layer does not reconstruct roster states
from before Front Office's first snapshot, even if a trade or injury record is
older than that observation.

### Major League Operations: current reactive needs

`majorLeagueReactiveNeeds` owns the first MLB operational decision layer. It
combines a current normalized organization roster with persisted observed events
and returns only needs that remain open now. V1 supports an objective active-
roster-capacity opening and basic role coverage after an observed MLB
availability loss. Role coverage is deliberately factual: starting pitchers,
relievers, and a player's exported primary position are considered; it does not
evaluate player quality, defensive versatility, or upgrade value.

A historical event is revalidated against current state on every read. If an
available active player now supplies the affected basic role, the historical
incident is returned as resolved rather than an ongoing need. Need identities
are stable from the causal incident, so an unchanged later import produces a
continuing need rather than a new one. This derived-current-state model avoids
another persistent workflow state while retaining the original observation and
evidence in roster history.

Trade-supported departures are structural. Injury-supported IL/IL-60 losses are
temporary only when the explicit injury record supplies a positive duration;
otherwise their horizon is unknown. Unsupported availability losses retain an
unknown cause. Organizational Philosophy and the prohibited continuous
`players_value` fields play no role in whether a need exists. Candidate
assembly, readiness, transaction planning, and proactive upgrade detection are
later layers.

### Internal MLB responder assembly

`assembleInternalResponders` accepts one open role need and returns two stable,
non-preferential sets: currently available active-MLB players who can cover the
role, and available minor-league call-up discussion candidates. Primary
position and current pitcher role establish direct fit; a revealed current
fielding rating establishes a secondary position fit. The response retains that
evidence rather than assigning a fit score. Stable player-ID ordering is only
for API repeatability and carries no preference.

For AAA players with a current Player Development prospect assessment,
`mlbDiscussionDevelopmentGates` is the authoritative AAA→MLB gate: a
prohibited player is explicitly excluded and an approved player carries the
decision evidence. AAA organizational depth with no applicable prospect
assessment remains discussable but is clearly labeled `not_applicable`, not
developmentally approved. This avoids treating prospect status as a call-up
requirement while not letting a roster need manufacture readiness. The present
Player Development gate does not establish lower-level-to-MLB readiness, so
those players are excluded rather than automatically promoted.

IL/IL-60, DFA, waiver, and unavailable players are excluded using shared roster
state. 40-man status and corresponding-move consequences are preserved only as
factual transaction context: Phase 3 owns whether a responder can actually be
placed on the roster. No candidate ranking, Organizational Philosophy, or
continuous `players_value` field participates in assembly.

### Transaction solution planning

`planTransactionSolution` composes the selected responder and need with the
authoritative `evaluateRosterAction(..., 'recall')` result. An active-MLB
responder has an internal-reassignment path: it needs no recall or 40-man move,
but records that the player’s existing MLB role may change. A minor-league
responder can be feasible, feasible with corresponding decisions, ineligible,
or indeterminate; these are transaction-state results, not a judgment of the
player.

When capacity is full, the plan exposes an active-roster-space or 40-man-space
decision with no selected player. A non-40-man responder may require a logical
planning sequence of 40-man space, 40-man addition, active-roster space, and
recall. That is not asserted to be a complete legal CBA sequence: waiver, DFA,
option, and exact ordering details remain unknown when the export/rules engine
cannot establish them. Organizational consequence and synthesis layers consume
this result unchanged; they do not reinterpret its feasibility.

### Organizational consequence analysis

`analyzeOrganizationalConsequences` aggregates the factual consequences of one
selected transaction solution. An active-MLB reassignment records the immediate
prior-role consequence (for example, moving a reliever into a starting role)
without recursively generating MLB needs. A minor-league recall asks Minor
League Operations to evaluate the source affiliate as though the responder were
removed. The scenario is read-only: it neither alters imported rosters nor
creates roster-history observations.

The package distinguishes the factual player removal from post-removal coverage
and from a newly created or pre-existing/worsened operational problem. It uses
the farm roster-health model’s actual position, rotation, and bullpen
thresholds, excluding teammates objectively unavailable through roster state.
When a source problem exists, `minorLeagueConsequences.ts` retains its unranked
first-response discussion set and invokes the shared farm cascade planner. Each
level-changing hypothetical move must have an existing Player Development
authorization. Minor League Operations may compare the returned farm plans
with its own philosophy dimensions, but it does not choose or execute a move.

Phase 4A initially stopped at the first unresolved farm problem; it now consumes
the farm-owned cascade result described below. Corresponding active/40-man
decisions from the transaction plan remain explicitly unresolved. The package
itself contains no organizational-cost score or cross-responder preference;
the synthesis layer composes it with its original responder before comparison.

### Minor League Operations cascade planning

`planMinorLeagueCascade` is the shared bounded search used for an initial farm
perturbation and exposed by the normal farm-operations API. It evaluates each
in-memory assignment state through `computeMinorLeagueRosterHealth`, including
the same position coverage, rotation, bullpen, availability, body-count, and
exported affiliate active-roster-capacity rules used for current rosters. An
affiliate's positive `leagues.rules_active_roster_limit` is enforced using its
own league; a zero is an explicit no-limit rule, while a missing field remains
unknown rather than being guessed. Baseline health is retained for consequence
scenarios: only a new or materially worsened issue becomes a cascade
obligation; unchanged pre-existing flaws remain context rather than being
silently repaired.

The planner explores Player Development-authorized normal promotions,
skip-level promotions, and demotions to actual affiliate destinations. It also
allows existing unevaluated organizational depth only for same-level
reassignment, preserving the established veteran/depth behavior without using
roster need to manufacture a promotion. Each move retains development evidence
and is applied solely to an assignment map, so a player cannot exist on two
hypothetical rosters.

Search is deterministic and bounded at three moves, 160 explored states, 24
actions per state, and eight retained plans. Canonical assignment-state IDs
deduplicate equivalent states; a player cannot move twice in a plan. Plans are
complete, partial, or truncated; missing readable farm state is indeterminate.
An over-capacity destination is an unresolved scenario problem, so a plan that
otherwise fills a role cannot be complete. The planner may relieve an overage
only through its existing defensible assignment paths; it does not select a
release, displacement, or any other outgoing transaction.
The persisted philosophy dimensions used only among defensible plans are
`promotionAggressiveness`, `versatility`, and `rosterDepth`; neutral or
non-distinguishing evidence yields tied plans. Search truncation never means no
other plan exists.

### Complete MLB solution synthesis

`synthesizeMajorLeagueSolutions` handles one current reactive MLB need. Its
unit is a complete causal variant: need, legitimate responder, visible role
profile, Player Development context, authoritative transaction path, immediate
MLB consequence, and one specific farm plan. A responder with two retained
Minor League Operations plans therefore yields two variants; cascades are never
cross-producted across responders. Active MLB responders and recalls whose
source remains healthy carry an explicit no-op farm result.

`majorLeagueRoleSuitability.ts` describes the baseball shape of an already-
legitimate responder. Position-player evidence includes visible current
batting components, target-position and secondary fielding grades, experience,
handedness, speed, and objective current-level batting performance. Pitcher
evidence includes visible current stuff/movement/control, stamina, repertoire,
handedness, objective current-level performance, and exported workload facts.
It creates no universal MLB threshold or overall quality score. Missing
evidence remains limited or insufficient, and continuous `players_value`
figures remain prohibited.

Factual completeness is classified before preference as fully actionable,
feasible with an unresolved GM roster decision, partial organizational
solution, indeterminate, search-truncated, or ineligible. Organizational
Philosophy cannot change that classification. The MLB comparison uses the
persisted organization's existing `competitiveWindow`, `riskTolerance`,
`promotionAggressiveness`, `upsidePreference`, `defenseEmphasis`,
`pitchingDepth`, `rosterDepth`, and `versatility` dimensions. Need horizon,
transaction disruption, visible role style, farm stability, and secondary MLB
role continuity remain separate inspectable axes.

Minor League Operations retains ownership of farm preference. Phase 5 carries
each plan's preference status and reasons as delegated evidence; it never
re-applies `promotionAggressiveness`, `versatility`, or `rosterDepth` to the
same farm moves. MLB comparison uses structured non-dominance rather than an
opaque master score. Multiple preferred variants and ties are valid;
insufficient, indeterminate, and truncated alternatives are retained as not
responsibly comparable. Stable variant-ID order is presentation consistency,
not baseball preference. The result remains advisory and the GM makes the
final decision.

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
