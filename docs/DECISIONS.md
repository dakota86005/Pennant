# Product and architecture decisions

These records capture durable decisions, not a list of everything currently
implemented. Each entry states its implementation status so future intent is
not mistaken for present behavior.

## D-001 — Simulate front-office work, not a recommendation chatbot

**Status:** Accepted. **Implementation:** Partial and ongoing.

Front Office's primary goal is to feel like running a baseball organization as
the GM. The experience should expose decisions, constraints, evidence,
alternatives, organizational voices, and consequences. AI is a supporting
staff capability inside that system, not the product's generic answer box.

Consequences:

- Deterministic domain models compute facts, eligibility, and recommendations.
- AI may retrieve, explain, compare, role-play staff viewpoints, and generate
  grounded narrative; it must not silently replace those models.
- Interfaces should give the GM evidence and agency, not just a score or a
  confident imperative.

The current staff chat calls the application's own API and the farm workspaces
show evidence, safeguards, and alternatives. Applying this standard uniformly
across all features remains ongoing.

## D-002 — Preserve organizational knowledge and fog of war

**Status:** Accepted. **Implementation:** Present in scouting/development paths;
ongoing audit required elsewhere.

Subjective player-ability judgments must use the organization's/scouting
director's observed ratings and development history. Hidden OOTP true-talent
values are out of bounds. Visible exported potential fields—including fields
named `*_talent_*`—are usable only as the organization's scouted projection,
not as proof of underlying truth.

Objective facts such as statistics, contracts, service time, injuries, roster
status, age, schedule/results, and transactions may be treated as known when
the export provides them.

Consequences:

- Unknown ratings remain unknown; do not backfill them with omniscient data or
  AI inference.
- A rating-history change is an observed scouting change. It cannot be labeled
  pure true-talent development.
- Comparisons should use the organization's available evidence and identify
  small samples, missing fields, and low-confidence populations.
- Synthetic fixtures must model only visible/exported information.
- Continuous `players_value` fields are not approved scouting evidence for
  Major League Operations: their organization-visible provenance is
  unestablished. They remain out of bounds until a source-level audit proves
  otherwise; missing values must not be treated as zero.

## D-003 — Development constrains; philosophy prefers; operations solves

**Status:** Accepted. **Implementation:** Implemented for the current farm
assignment/operations work, with known gaps in the roadmap.

Player Development determines which assignments or development decisions are
defensible. Organizational Philosophy expresses preferences among defensible
choices. Minor League Operations solves roster and assignment problems using
the development constraints and organizational preferences.

Consequences:

- Roster need cannot create a promotion or demotion case.
- Philosophy cannot legalize an assignment rejected by development evidence.
- Operations may choose among authorized destinations and rank alternatives
  based on coverage, roster structure, source health, depth, and philosophy.
- The response must expose blockers, safeguards, and philosophy adjustments so
  the GM can understand why a proposal exists.

## D-004 — The user/GM makes the final decision

**Status:** Accepted. **Implementation:** Current farm/retention outputs are
read-only; no OOTP transaction writeback exists.

The application can recommend, flag, simulate, and explain, but it does not
execute the baseball decision for the user. Release-candidate language is a
request for GM review, not authority to release a player.

Any future mutation workflow must be separately designed, explicitly approved,
previewable, reversible where possible, and require a clear user confirmation.
Automatic OOTP save mutation is not an incidental extension of a read model.

## D-005 — Resolve the current organization automatically

**Status:** Accepted. **Implementation:** Partial.

Organization-specific features should use an established organization context
without asking the user for a raw OOTP organization ID. Resolution should
prefer an explicitly saved organization, then the OOTP organization marked as
human managed, and use an intentional fallback only when neither exists.

The current React app follows this order and several server/AI helpers query
`human_team = 1`, but most routes still require an explicit `:orgId` and there
is no shared server resolver. Centralizing this behavior is roadmap work.

Consequences:

- Do not add new manual ID fields to the user experience when current context
  is available.
- Keep IDs in APIs and persistence where they are stable identifiers.
- Switching organizations for scouting remains a deliberate supported action;
  automatic resolution determines the default, not a permanent lock.

## D-006 — Local-first data and explicit AI egress

**Status:** Accepted. **Implementation:** Present.

Imported league data, history, settings, caches, and credentials live locally.
AI is optional. When an AI feature is invoked, only the context assembled for
that feature is sent to the selected provider. Non-AI features must work with
no provider credential.

Credentials use environment variables or local credential storage; Electron
uses OS-backed encryption when available. Static exports exclude secrets and
writable/private features.

Consequences:

- Never commit credentials, API keys, `.env` files, live OOTP saves, generated
  databases, AI caches, settings, chat histories, local paths, or
  machine-specific private data.
- Never use a live save as a test fixture or attach it to an issue.
- Review screenshots and logs for local paths and secrets before sharing.

## D-007 — Treat OOTP CSV exports as a variable external schema

**Status:** Accepted. **Implementation:** Present, with per-feature audits still
needed as fields are added.

OOTP versions, locales, and saves produce different CSV shapes. The importer
therefore discovers delimiters, encoding, tables, and columns, while query
modules check optional inputs where possible.

Consequences:

- A feature should fail narrowly when optional evidence is absent, preserving
  the rest of the page.
- Queries should use `tableExists`, `tableColumns`, `hasColumns`, or
  `locateColumn` when an export field is not universally available.
- New behavior needs fixtures for missing/alternate shapes, not only the
  developer's current save.

## D-008 — One domain API serves browser, desktop, static generation, and AI

**Status:** Accepted. **Implementation:** Present.

Express and the server domain modules are the single computational backend.
React is a client. Electron embeds the same server and UI. Chat tools call the
same API endpoints used by pages so the assistant cannot drift into a second
implementation of standings, contracts, or player evaluation.

Consequences:

- Put reusable baseball calculations in server modules with explicit outputs.
- Do not encode decisive baseball rules only in React rendering or prompts.
- Keep Electron's IPC bridge limited to desktop-only capabilities.

## D-009 — Separate replaceable imports from persistent observations

**Status:** Accepted. **Implementation:** Present.

`league.db` represents the latest OOTP export and may be rebuilt. `history.db`
persists observations and user-owned state across imports. This separation is
what makes scouting-development history possible without corrupting or
accidentally retaining stale imported tables.

Consequences:

- Re-import code may replace imported tables but must not erase history.
- Persistent records need save/organization/player keys that prevent data from
  bleeding across saves.
- Both databases remain generated private data and are ignored by Git.

## D-010 — Safe Git and repository hygiene are agent requirements

**Status:** Accepted. **Implementation:** Documented in `AGENTS.md` and backed
by ignore rules.

AI coding agents must inspect the worktree, preserve unrelated changes, avoid
destructive Git commands, and never commit or push without explicit direction.
They should make the smallest scoped change, validate it proportionally, and
update durable documentation when a boundary or project-state fact changes.

## D-011 — Shared roster state precedes MLB opportunity decisions

**Status:** Accepted. **Implementation:** Initial read-only engine present.

Current roster and transaction facts have one authoritative server-side
interpretation in `rosterTransactionState.ts`. Major League Operations, Minor
League Operations, and 40-man planning must consume that state/rule layer
rather than independently interpreting raw OOTP flags.

Consequences:

- Action answers use eligible, ineligible, or indeterminate semantics; missing
  columns and incomplete rule evidence cannot become a convenient default.
- A full active or secondary roster yields a corresponding-move requirement,
  not an invented recommendation about who should be removed.
- The initial engine evaluates only recall, standard option/demotion, and
  40-man addition state. It does not simulate transactions or emulate every
  CBA rule.
- Explicit trade and injury history may be read as events. Current-state flags
  and generic messages must not be reverse-engineered into option, release, or
  recall history.

## D-012 — Persist observations before interpreting roster causality

**Status:** Accepted. **Implementation:** Present.

Roster history is a sequence of normalized, imported observations in the
persistent `history.db`, not a reconstruction from the current export or page
access. A completed CSV import may create a snapshot; API reads may not. The
snapshot is save-scoped and is deduplicated against its immediate predecessor
by imported game date plus a canonical roster-state hash. This retains distinct
same-date imports while avoiding duplicate observations.

Consequences:

- A snapshot, an observed transition, and a causal correlation are distinct
  domain concepts. A transition may carry several factual changes at once.
- `observed` means two saved states demonstrate a difference. `explicit` means
  an authoritative imported history row. `corroborated` means a matching
  explicit event supports an observed transition. `unknown` remains the cause
  when that support is unavailable; `inferred` is not used to turn ordinary
  assignment changes into transactions.
- Trades corroborate only matching organization changes; injuries corroborate
  only observed IL/IL-60 entry. An injury row alone is not an IL transaction.
- No authoritative pre-Front Office roster timeline is claimed. Earlier
  imported trade/injury rows remain evidence, not missing snapshots.

## D-013 — MLB needs are current, causal, and solution-agnostic

**Status:** Accepted. **Implementation:** Initial reactive need detection
present.

Major League Operations may derive a current reactive need from the combination
of a persisted observed roster loss and the current normalized MLB roster. A
roster event does not itself remain a need: the current roster must still show
an active-roster opening or a lack of basic coverage for the affected observed
role. Derived needs have stable incident identities and are re-evaluated on
each import/read rather than persisted as an independent workflow state.

Consequences:

- V1 recognizes only objective active-roster capacity and basic role-coverage
  needs caused by an observed MLB availability loss. It is not strategic
  roster-upgrade detection.
- Trade-correlated organization departures have a structural horizon. An
  injury-correlated IL/IL-60 entry is temporary only when explicit injury
  duration is exported; otherwise horizon and/or cause remains unknown.
- Current active coverage resolves a historical role loss. Repeated unchanged
  imports therefore continue one conceptual need instead of manufacturing new
  items.
- Organizational Philosophy, subjective ratings, and `players_value`
  continuous fields cannot affect whether a need exists. Candidate assembly,
  readiness, transaction sequencing, and a removal choice remain later work.

## D-014 — Assemble responders without selecting a solution

**Status:** Accepted. **Implementation:** Initial internal responder assembly
present.

An open MLB role need may produce an unranked discussion set of currently
available active-roster alternatives and internal minor-league call-up
responders. Major League Operations establishes role relevance and availability;
Player Development remains the authority on whether an evaluated AAA prospect
is developmentally defensible for MLB discussion.

Consequences:

- Direct fit uses the exported primary position or current pitcher role;
  secondary position fit requires a visible current fielding rating. No hidden
  potential rating or arbitrary fit score is substituted.
- An evaluated AAA player prohibited by Player Development is excluded even
  when the MLB need is acute. AAA depth without an applicable prospect
  assessment is not silently excluded merely for lacking prospect status, but
  is labeled as not developmentally evaluated/approved.
- The current gate does not justify AA-or-lower direct MLB discussion. Those
  players remain outside the responder set until Player Development supplies a
  trustworthy gate.
- 40-man status and corresponding moves are transaction facts, not baseball
  candidacy filters. Transaction feasibility, downstream minor-league effects,
  philosophy, and a final choice are deferred.

## D-015 — Describe transaction paths without choosing the corresponding move

**Status:** Accepted. **Implementation:** Initial selected-responder planning
present.

Transaction Solution Planning composes one legitimate responder with the shared
roster/transaction engine. It describes the factual path needed to use that
player, but does not select the responder, name a player to option/DFA/remove,
or execute a transaction.

Consequences:

- An existing active-MLB responder follows an internal-reassignment path with
  no recall/40-man action, while retaining its potential current-role
  consequence for later analysis.
- A minor-league recall retains `eligible`, `ineligible`, and `indeterminate`
  semantics from `rosterTransactionState.ts`. Full active or 40-man rosters
  create explicit corresponding decisions rather than making a responder
  ineligible.
- The plan may present a logical action order, but it must label incomplete
  CBA/waiver/DFA/option sequencing as unknown. It cannot invent an option or
  waiver solution for an unnamed outgoing player.
- Need cause/horizon is carried as context only. No player quality, ranking,
  philosophy, service-time strategy, or prohibited `players_value` field may
  affect technical feasibility.

## D-016 — Analyze a selected solution’s consequences without selecting its remedies

**Status:** Accepted. **Implementation:** Initial first-order organizational
consequence analysis present.

Major League Operations aggregates the immediate MLB and source-affiliate facts
created by one selected Phase 3 solution. It does not score, rank, recommend,
or execute that solution. An active-MLB reassignment identifies only the
immediate prior-role consequence; it does not recursively produce MLB needs.

For a minor-league recall, Minor League Operations owns a read-only
hypothetical removal scenario using its existing position, rotation, and
bullpen roster-health rules. Factual removal, remaining coverage, and a newly
created versus pre-existing/worsened operational problem are separate fields.
Unavailable teammates are excluded where exported status establishes that they
cannot be used; missing source role or roster evidence stays unknown.

Consequences:

- A source-affiliate shortage is delegated to Minor League Operations. The
  initial Phase 4A response was an unranked first-response set; D-017 now owns
  the bounded multi-level hypothetical cascade. Roster pressure never
  manufactures Player Development authorization.
- No lower-level player is selected and no current assignment is mutated. A
  partial or truncated bounded cascade remains an explicit unresolved farm
  consequence rather than a claimed complete plan.
- Active- and 40-man corresponding decisions remain GM/MLB Operations
  decisions with no outgoing player selected, even in a complete consequence
  package.
- Need cause/horizon, transaction unknowns, and existing responder-development
  context carry forward as facts. Organizational Philosophy and prohibited
  continuous `players_value` fields remain outside this phase.

## D-017 — Use one bounded farm-cascade planner for normal and hypothetical work

**Status:** Accepted. **Implementation:** Initial shared cascade planner
present.

Minor League Operations owns `minorLeagueCascadePlanner.ts`. It searches an
in-memory organizational assignment state, rather than a linear list of callups,
so an action may resolve one scenario problem while creating another. Baseline
health separates a scenario-caused deficiency from unchanged pre-existing farm
health; normal operations may instead start with current deficiencies.

Consequences:

- Player Development eligibility gates every level-changing action and its
  reasons/destination evidence remain attached to the move. Unevaluated depth
  is limited to existing same-level reassignment behavior.
- `promotionAggressiveness`, `versatility`, and `rosterDepth` are the only
  persisted philosophy dimensions currently used for inspectable preference
  among defensible plans. They never alter eligibility, availability, or facts.
- The search is deterministic, deduplicates canonical assignment states,
  forbids a player from moving twice, and is bounded at depth 3, 160 states,
  24 actions per state, and 8 retained plans. A reached bound is explicit
  truncation, not proof that alternatives do not exist.
- The shared normal/hypothetical roster evaluator enforces a positive
  affiliate-league `rules_active_roster_limit`; zero means the export
  explicitly permits no limit, and a missing rule remains unknown. A new or
  worsened overage is a cascade problem. It may be relieved only by an already
  defensible assignment path; no release, displacement, or transaction solver
  is implied by an unresolved overage.
- Major League Operations consumes this farm-owned result for a selected
  recall; it does not maintain an MLB-only cascade algorithm. No hypothetical
  state mutates OOTP, imported SQLite data, or roster history.

## D-018 — Compare complete reactive MLB solution variants without a master score

**Status:** Accepted. **Implementation:** Initial Phase 5 synthesis present.

The comparison unit is one coherent need → responder → transaction →
organizational consequence → specific farm-plan path. One responder may yield
multiple variants when Minor League Operations returns materially different
cascades. No responder may inherit another responder's cascade.

Consequences:

- Completeness is factual and precedes preference: fully actionable,
  feasible with an unresolved GM decision, partial organizational solution,
  indeterminate, search-truncated, and ineligible remain distinct.
- Role suitability describes visible current batting/pitching/fielding,
  handedness, speed/stamina/repertoire, and objective performance evidence for
  a responder already admitted by Phase 2. It neither repeats Player
  Development readiness nor creates a universal MLB-quality threshold.
- MLB-level interpretation uses only the persisted shared dimensions
  `competitiveWindow`, `riskTolerance`, `promotionAggressiveness`,
  `upsidePreference`, `defenseEmphasis`, `pitchingDepth`, `rosterDepth`, and
  `versatility`. No MLB-only philosophy object or hidden weight exists.
- Farm-plan philosophy remains owned by Minor League Operations. Phase 5
  retains its status/reasons as delegated evidence and does not re-score the
  same assignments, explicitly preventing philosophy double-counting.
- Need cause/horizon, transaction requirements, source-affiliate cascade,
  development evidence, secondary MLB role consequences, and unknowns remain
  inspectable. Philosophy interpretations are stored separately from facts.
- Preference uses structured non-dominance, not an authoritative scalar.
  Multiple preferred variants, conditional alternatives, stable ties, and
  cannot-responsibly-compare results are valid. Stable ID ordering is not a
  baseball judgment.
- The layer handles current reactive needs only. It does not detect proactive
  upgrades, choose an outgoing roster player, solve the return/demotion
  lifecycle, expose a UI/API endpoint, call AI, execute a transaction, or make
  the GM's final decision.
