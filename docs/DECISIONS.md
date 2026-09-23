# Product and architecture decisions

These records capture durable decisions, not a list of everything currently
implemented. Each entry states its implementation status so future intent is
not mistaken for present behavior.

## D-001 — Simulate front-office work, not a recommendation chatbot

**Status:** Accepted. **Implementation:** Partial and ongoing.

Pennant's primary goal is to feel like running a baseball organization as
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

**Status:** Accepted. **Implementation:** Enforced for Player Development and
Minor League Operations through the scouted-evidence adapter (D-017); scouting
history is present; pre-fork trade, contract, franchise, and roster surfaces
still read `players_value` and are not yet audited.

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

## D-003 — Development constrains; philosophy prefers; operations solves

**Status:** Accepted. **Implementation:** Implemented for the current farm
assignment/operations work (authority boundary enforced structurally, D-019),
with known gaps in the roadmap.

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

The former deviation from the second consequence is corrected; see D-019.

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

## D-017 — Subjective ability evidence comes only through the scouted-evidence adapter

**Status:** Accepted. **Implementation:** Present for Player Development and
Minor League Operations (`server/scoutedEvidence.ts`).

`players_value.oa`, `players_value.pot`, and every other continuous
`players_value` ability/talent field are **not** approved evidence for
subjective ability or development judgments. The export carries no viewer
organization, scouting-accuracy setting, or per-field visibility flag, and the
one in-repo comparison against the game (commit `6ca89c8`) was made on a save a
user reported at 100% scouting, where scouted and true grades coincide. A convenient exported field is
not organization-visible merely because it is exported. Such a field may be
approved only when its provenance is positively established as the
human-managed organization's visible scouting evaluation.

The approved source is the exported tool ratings (D-002): current
`*_ratings_overall_*`, potential `*_ratings_talent_*`, stamina and pitch grades,
and revealed fielding-position grades. That approval is by decision, not proof;
every result carries `declared_organization_visible` /
`not_verifiable_from_export`.

Consequences:

- One entry point. Development and operations code obtains a `ScoutedAbility`
  from `loadScoutedAbilities`; it does not read rating columns, `players_value`,
  or `gloves()` itself. `tests/evidenceBoundary.test.ts` fails if a guarded
  module does, or if a new module starts reading `players_value`.
- Missing stays missing. Absent, non-numeric, zero, and negative grades are
  unknown. A composite (unweighted mean of the visible tools) exists only when
  every tool is known. Potential is never inferred from current, or the reverse.
  There is no fallback to `players_value`.
- Ratings are normalized to 20-80 equivalents from the detected display scale,
  so thresholds keep their meaning; the native scale is reported.
- The composite is a Pennant summary, not OOTP's Overall. Pages that show
  `cur`/`pot` from these paths therefore differ from the game card by design.
- Consumers report incomplete evidence (`ratingsEvidence`, `ratingEvidence`,
  `missingEvidence`, destination-fit `unassessedComponents`) and treat what
  depends on it as unknown (D-018), never as a pass or a failure.
- Objective facts (statistics, age, contracts, service time, options, injuries,
  roster status, assignments, transactions) are unaffected and remain known.

**Remaining gaps:** scouting snapshots keep their own non-strict, native-scale
composite. Pre-fork surfaces (trade, contracts, franchise, roster/player
displays) still read `players_value`. Fielding-position grades are assumed to
share the tool ratings' scale. Unknown ratings no longer enter any development
arithmetic; see D-018.

## D-018 — Unknown evidence stays unknown: indeterminate, not imputed

**Status:** Accepted. **Implementation:** Present for Player Development
(readiness, protection, assignment authorization, destination fit) and Minor
League Operations (position and pitching operations, retention).

"We do not know" is distinct from "average", "bad", and "good". A missing
organization-visible rating is never replaced by a midpoint, average,
replacement value, or zero. Player Development represents evidence sufficiency
explicitly (`server/developmentJudgment.ts`):

- A rating-dependent constraint is `satisfied`, `not_satisfied`, or `unknown`.
- An assessment built from constraints is `indefensible` if any constraint is
  not satisfied (a known negative stands whatever else is unknown),
  `indeterminate` if none is but any is unknown, and `defensible` only if all
  are satisfied.
- Readiness is `null` when ratings maturity is; the range it could take is
  reported (`readinessRange`, the model's own outer bounds, not an estimate). A
  conclusion that holds across that whole range — poor production, a demotion —
  still stands. Protection is `null` (tier `null`) unless both current and
  potential are known.
- Objective evidence (production, sample, age/level context, status, history)
  is always evaluated and shown, including on an indeterminate assessment.

Consequences:

- **Philosophy cannot resolve unknown evidence.** Player Development's
  judgments never receive a philosophy (D-019), so no philosophy setting can
  turn an indeterminate assessment into authorization or into a rejection.
- **Operations must handle the third state.** `eligible` is true only for
  `defensible`; `eligible: false` does not mean rejected — read `judgment`.
  Position and pitching operations list an indeterminate candidate in
  `indeterminate` with the missing evidence and the destination's roster need.
  It is not planned (approved), not in `rejected`, and not ranked. Retention adds
  an `indeterminate` recommendation (after objective transaction guardrails,
  which still apply).
- **Indeterminate is not a roster decision.** It does not mean protect, hold,
  or block, and the GM may act despite it. No caller may encode it as one.
- Ranking-only terms that depend on an unassessed comparison are omitted rather
  than valued.

**Remaining gaps:** a destination-fit stretch cost that cannot be computed is
omitted from ranking (contributes nothing) rather than imputed; a pitcher whose
stamina is unknown keeps his current role as developmental role (flagged
`structureEvidence: 'unknown'`); a comparison population below 25 is treated as
not satisfied rather than unknown; neutral defaults for missing objective
context (level-average age, K% baseline) are unchanged.

## D-019 — Player Development authorizes; Organizational Philosophy only prefers

**Status:** Accepted. **Implementation:** Present (`prospectDecision.ts`,
`prospectAssignments.ts`, `assignmentPreference.ts`).

Whether an assignment is developmentally defensible is a function of evidence
and baseball-development rules. It is identical for every organization: for the
same player, evidence, and destination, `defensible` / `indefensible` /
`indeterminate` does not vary with philosophy. Organizational Philosophy
expresses which of the DEFENSIBLE alternatives the organization prefers, and
nothing else.

Before this decision, `promotionAggressiveness` set the promotion threshold
(76 ± 10) that ordinary-promotion and MLB-discussion eligibility, the skip-level
requirement above its floor, and the recommendation bands were measured against.
An aggressive organization could therefore call defensible a promotion a neutral
one could not, and a conservative one could call indefensible what a neutral one
could authorize. The threshold combined two concepts and is now split:

- **Developmental (Player Development):** `development.promotionThreshold` —
  a base readiness of 76 moved only by age relative to level. It gates ordinary
  promotion and MLB discussion; a skip-level move needs ten more (never below 84,
  with fixed performance, maturity and sample floors); a demotion rests on
  objective production, sample and age. The 45-point minimum sample applies to
  every organization.
- **Preference (Philosophy):** `assignmentPreference.ts` runs after
  authorization and destination fit, and only annotates. Among the defensible
  promotion-direction assignments, plus staying (patience), aggressiveness
  chooses how far up the challenge ordering the organization prefers to reach:
  each defensible option is `preferred`, `acceptable`, or `disfavored`. A
  disfavored assignment is exactly as defensible as a preferred one.

Consequences:

- Player Development modules (`prospectDecision`, `prospectAssignments`,
  `destinationFit`, `developmentFit`, `developmentJudgment`) take no philosophy
  and may not import or mention it; `tests/philosophyBoundary.test.ts` enforces
  it statically and by behavior across philosophies.
- Philosophy cannot authorize an indefensible assignment, cannot make a
  defensible one indefensible, and cannot resolve an indeterminate one: an
  indeterminate assignment is never ranked and is never read as "stay".
- Demotion is not ranked: no philosophy dimension expresses demotion patience.
- Minor League Operations receives the defensible set, the indeterminate set
  separately, and the preference beside them (`assignments.preference`). It
  optimizes within the defensible set and never plans anything else. Its own
  philosophy-based ranking adjustments (`promotionAggressiveness`,
  `prospectPreservation`, and others) apply only to candidates Player
  Development has already authorized. Operations does not yet read the
  preference object; when it does, it must keep preference inside the defensible
  set and use it for ordering only, never as a cutoff.

**Remaining gaps:** retention still adds a philosophy adjustment to its
development score, which feeds release-candidate thresholds (a retention
judgment, not assignment authorization, but it blends the two); Operations'
same-level moves are ranked with philosophy-weighted costs.


## D-020 — Roster evidence has a source hierarchy, and three concerns stay separate

**Status:** Accepted. **Implementation:** Current State, Transaction Chronology
and Rights / Eligibility are all implemented (`playerState.ts`,
`transactionLog.ts`, `assignmentContext.ts`, `playerRights.ts`; see D-023).

An audit of a real macOS save overturned an earlier assumption that transaction
chronology is unavailable. OOTP keeps a live SQLite transaction log in the
save's `temp/` folder. The official CSV export remains the best broad source
for current state. They answer different questions, so roster evidence is read
in this order:

1. **Explicit CSV/export current state** — team, level, active and 40-man
   membership, injured-list flags, DFA/waivers and countdown, service time,
   option counters, contract kind. If OOTP exports a fact, it is read as
   exported and never re-derived from history or snapshots.
2. **Explicit live transaction log** — what happened and when: optioned,
   recalled, purchased contract, DFA/waivers, injured list, restricted list,
   release, Rule 5 return, injury rehab, and level moves. Unrecognised wording
   is kept as an `unsupported` event, not dropped and not interpreted.
3. **Pennant's observed snapshots** (`rosterStateHistory`) — a longitudinal
   fallback and a cross-check. A difference between two imports is evidence
   that state changed, never proof of which transaction changed it. It must not
   manufacture "optioned", "recalled", or "DFA" and must not override 1 or 2.

Every meaningful field carries a provenance (`explicit_export`,
`explicit_log`, `observed_snapshot`, `derived`, `unknown`) and, when unknown, a
reason (`source_unavailable`, `source_stale`, `rule_not_implemented`,
`not_exported_by_ootp`, `transaction_type_not_understood`,
`no_observed_example`, `no_explicit_event`) — see `server/provenance.ts`.

Three concerns are never collapsed into one roster object:

- **Current State** — what is objectively true now.
- **Transaction Chronology** — what explicitly happened.
- **Rights / Eligibility** — what may legally or operationally be done now
  (D-023).

Consequences:

- **40-man membership is `players_roster_status.is_on_secondary`.** The earlier
  inference (active, or secondary, or on the MLB injured list) reported 35
  against the export's 30 on a real save, counting five 60-day-IL players OOTP
  does not list. Whether such a player should occupy a slot is a rights
  question and is not settled by overriding the export.
- **Rehab is first-class.** A rehab player appears in the export as Triple-A, on
  the 40-man, not active, with no distinguishing flag — identical to an optioned
  player. Only the log tells them apart. A rehab assignment is not an option or
  a demotion (`ordinaryOption: false`). When the log is unavailable the same
  export state is `unattributed` with `ordinaryOption: null`; it is never
  assumed to be an option.
- The export outranks the log where they disagree about current placement: an
  open rehab episode in the log does not survive the export showing the player
  elsewhere.
- Option counters are preserved as exported. Nothing reads them as
  "optionable"; true optionability is unresolved.

## D-021 — The live log is found automatically and only ever read from a copy

**Status:** Accepted. **Implementation:** Present.

Normal use must need nothing beyond the OOTP database export the user already
makes. The save is derived from where the export lives
(`<save>.lg/import_export/csv` names its own `.lg`), and the live database from
the save (`temp/text_data.sqlite3`). A hand-picked `.lg` folder exists only as a
fallback (`POST /api/save-source`) for when derivation genuinely fails.

The live database belongs to OOTP and may be mid-write, so it is never opened in
place. `server/liveLogSnapshot.ts` copies the database and its WAL to a private
temp directory, re-stats the source and rejects a copy that moved or is the
wrong size, validates the copy (`quick_check` plus required tables), retries
when it is torn, opens only the copy read-only, and deletes it on close. The
`-shm` file is not copied: it is a shared-memory index SQLite rebuilds from the
copied WAL. Nothing ever opens an OOTP file for writing.

Consequences:

- If the save or database cannot be found or read, Pennant continues on CSV
  state and reports the log as unavailable, with the reason.
- Log text is read as bytes and decoded as UTF-8 with a Windows-1252 fallback:
  OOTP stores some rows in a legacy encoding (`Vázquez` as byte `0xE1`).
- Parsing the `.dat` binaries remains out of scope; `last_date_simulated.dat`
  is the one exception, a seven-byte date whose layout is inferred from one
  real save and rejected as unknown if it does not decode to a valid date.

## D-022 — Freshness is measured in simulated game days, never wall-clock time

**Status:** Accepted. **Implementation:** Present (`dataFreshness.ts`).

The save, the CSV export, and the transaction log are each placed on one basis:
the last in-game day whose games have been simulated. An export's
`leagues.current_date` names the day about to be played, so it reflects the day
before (verified: `current_date` 2026-5-16, last played game and log 2026-5-15).
File modification times are diagnostics only.

Consequences:

- The log is judged by how far the database has been written (the newest date
  across its transaction, history, news, and injury tables), not by its newest
  transaction, so an off-day does not make it look behind.
- Overall roster evidence is `current`, `partial`, `stale`, or `unavailable`. A
  missing or lagging log makes it `partial` — current state is intact,
  chronology-dependent reasoning is limited — and is never reported as a stale
  snapshot. Only the CSV being behind the save is `stale`, with an
  action-oriented message to export again.
- Moves made on the current, not-yet-simulated day are dated that day in the
  log and are in an export taken afterwards; they do not make the export look
  behind. A move made after the export on the same day cannot be detected by
  date.

## D-023 — Rights are evaluated per action, with three answers and a stated basis

**Status:** Accepted. **Implementation:** Present (`server/playerRights.ts`,
`server/leagueRules.ts`; roster crunch and the player card consume it).
Research and experiments: [RIGHTS_RESEARCH.md](RIGHTS_RESEARCH.md).

Given what Pennant knows, which transactions are available? Each action —
option, recall, add to the 40-man, designate for assignment, outright
assignment, activate from the injured list — is evaluated independently and
answers `eligible`, `ineligible` or `indeterminate`. Missing rule knowledge is
never turned into eligibility or rejection, and a GM may still act manually.

- **Pure, layered.** The evaluator reads a `PlayerState`, an `AssignmentContext`,
  the exported league rules, roster counts and source freshness. It opens no
  table, log or snapshot. The direction is OOTP sources → state/chronology →
  rights → operations → GM. A consumer must not reconstruct a rights conclusion
  from raw columns (`tests/playerRights.test.ts` checks roster crunch).
- **Every reason names its basis:** `export_state` (a value the export
  states), `observed` (seen in a controlled copied-save experiment),
  `documented` (OOTP's wiki/manual) or `observed_and_documented`. An observation
  that contradicts documentation wins; documentation alone is used only where it
  agrees with everything observed and is labeled as such.
- **League rules are read, not assumed:** option rule, DFA and waiver periods,
  active/expanded/40-man limits come from `leagues.*` as exported.
- **Requirements are separate from eligibility.** An unmet roster spot does not
  make a recall ineligible; it is listed as an unmet requirement. An unknown
  requirement makes the answer indeterminate.
- **Evidence is judged per action.** A stale or missing export makes every
  answer indeterminate. The transaction log matters only where chronology
  matters (a rehab assignment and an option are identical in the export, so a
  recall needs a current log). A lagging log therefore leaves current-state
  conclusions intact.
- **The export outranks log wording.** `Assigned X to Triple A` after a DFA is an
  outright or an option depending on `is_on_secondary` and the option counters;
  `Optioned` is not a complete record of major-to-minor moves; `Purchased the
  contract` also describes recalling a 40-man player.

Rules encoded and their weight (details in the research record): 3 option years
and a 5-year consent threshold (observed and documented); the option year is
charged at the first day rollover after leaving the active roster (observed,
one same-day round trip uncharged); no minimum minor-league stay before recall
(observed, human and AI); DFA 7 days containing a 3-day claim window
(documented, league-exported, observed); the 60-day IL removes a player from the
40-man (documented, 68 of 68 exported); a player who clears waivers and is
under 5 years is outrighted off the 40-man (observed twice).

**Remaining indeterminate, deliberately:** activation from either injured list;
Rule 5 exposure (the export gives a 0/4/5 window, not a countdown); re-optioning
within the season that used the last option year; a fourth option year; rehab
returns; designating an injured or rehabbing player; claims, refusals and
free-agency elections; trades. Each returns `indeterminate` with the missing
evidence, never a default.

## D-024 — MLB Operations is a consumer: needs from state, staged verdicts, no ranking

**Status:** Accepted. **Implementation:** Present for one slice (`server/mlbRoster.ts`,
`mlbNeeds.ts`, `mlbResponses.ts`, `mlbEvidence.ts`, `mlbOperations.ts`). Design and the audit
of `origin/feature/mlb-operations`: [MLB_OPERATIONS.md](MLB_OPERATIONS.md).

Major League Operations answers "what problems need my attention on the major-league
roster, what could address them, what would each require, and what follows?" It
coordinates specialists and owns none of their answers.

- **Needs are derived from the current export's Player State**, never from differences
  between Pennant's own imports (a snapshot difference proves state changed, not why:
  D-020), and are never persisted. A need that stops being true is simply not returned. A
  cause is a stated fact about a named player, or absent; Pennant does not infer one.
  Roster standards (5 SP, 7 RP, 2 C) are named assumptions, shown with each need.
- **Stages are never collapsed and no candidate silently disappears.** Discovery is
  objective; availability comes from Player State; development from Player Development's
  MLB assessment (`unassessed` is neither a pass nor a rejection, D-018); rights from Player
  Rights per required action; role fit from Player Development's destination fit at the MLB
  level; consequences from roster counts, Minor League Operations' read-only scenario and
  contract facts. A candidate that fails a stage stays visible in a group naming the stage.
- **A transaction path is only as certain as its least certain step.** Any `indeterminate`
  or unevaluated step makes the path indeterminate; MLB Operations composes `ActionRights`
  and never decides legality.
- **No ranking, no score.** Groups and candidates are ordered by path kind, level and name.
  Organizational Philosophy annotates a candidate that is valid on every stage
  (`preferred` / `acceptable` / `disfavored` / `no_preference`, naming the dimension) and
  can neither authorize, block, nor resolve an unknown.
- **The GM may pose a what-if** ("if X is unavailable"); it is labelled hypothetical and
  states that nothing says he will be.
- **Read-only.** Nothing is executed or written.

The old branch's `rosterTransactionState`, snapshot-based need detection, role-suitability
and cascade planner were not carried over (MLB_OPERATIONS.md §2). Guarded by
`tests/mlbOperationsBoundary.test.ts`.

**Remaining gaps:** performance-driven and bench/positional needs; "add to the 40-man and
promote" is not one Rights action, so non-40-man paths are `indeterminate`; IL activation
rules; Minor League Operations counts rehabbing players in roster health.

**Amended (second pass):** the role-coverage numbers are minimum floors, not roster targets, and
are data (`CoverageFloors`); a candidate Player Development has not completed an evaluation of
is "Evaluation incomplete", visible but never an actionable solution; ways to clear an active
spot are grouped by transaction class, not listed flat; a non-40-man promotion is composed from
two Player Rights component actions with no combined right.

## D-025 — Development defensibility is contextual, and Player Development owns the context

**Status:** Accepted. **Implementation:** Present (`server/mlbAssignmentContext.ts`,
`org.ts` `mlbAssignmentAssessments`). See [MLB_OPERATIONS.md](MLB_OPERATIONS.md) §15.

Whether a major-league assignment is developmentally defensible depends on the assignment
context: a durable role, temporary depth, a bench role, a short bullpen assignment or a spot
start are different developmental acts. Player Development answers per context; MLB
Operations only describes the contemplated context and never holds a development threshold
of its own or a bypass for veterans.

- The durable bar is relieved for a temporary context by the context's exposure, shrunk by
  the developmental **stakes** (protection tier from visible ratings and age). A core prospect
  gets no relief; nobody is waived for being a veteran.
- Evidence: current-level production against the relieved bar, or established Triple-A/MLB
  experience with low stakes. Unknown ratings, no career data, or no established route leave
  the assessment `indeterminate` (D-018); philosophy never enters (D-019).
- An unknown duration is not assumed to be any context; see D-027 (this amends the earlier rule that assessed it as the most demanding context).

## D-026 — Rehab assignees are not ordinary affiliate members

**Status:** Accepted. **Implementation:** Present (`server/rehabAssignments.ts`, applied in
`minorLeagueRoster`, `minorLeagueMoves`, `pitcherRosterSimulation`, `minorLeagueRetention`).

A player on an injury-rehab assignment is a parent-club player; the export lists him exactly
like an optioned one (D-020). When an explicit, current log shows the rehab he is excluded from
ordinary affiliate roster health, pitching staff, hitter coverage and retention. When nothing
explains a 40-man player below MLB he is counted and named as ambiguous (unknown stays
unknown), and consequences that depend on him say so. Consumers such as MLB Operations do
not work around it.

## D-027 — Unknown assignment duration stays unknown; context-dependent defensibility is a result

**Status:** Accepted. **Implementation:** Present (`server/mlbAssignmentContext.ts`
`resolveAcrossDurations`, `server/mlbResponses.ts`). See [MLB_OPERATIONS.md](MLB_OPERATIONS.md) §22-§23.

MLB Operations must not turn a missing duration into a durable-role assumption. When the
expected duration is unknown, Player Development judges temporary depth and a durable
assignment. Both defensible or both indefensible: that result, regardless of duration. One
defensible and one not (or not established): **`context_dependent`**, a first-class result
beside the D-018 three states, worded as dependent and never presented as open until the GM
chooses a duration or a context. Missing evidence in every defensible context stays
`indeterminate`. The GM is not asked for a duration when the answer would not change the
judgment; the GM can always override the context.

The relief and experience figures in `mlbAssignmentContext.ts` are **provisional calibration
parameters**, not baseball facts, declared once, marked, and stamped on every assessment. The
core-prospect rule and the experience-cannot-establish-high-stakes rule are architecture, not
calibration.

## D-028 — The active-roster spot and the 40-man spot are separate constraints; paths are composed

**Status:** Accepted. **Implementation:** Present (`server/mlbResponses.ts`,
`server/playerRights.ts` `placeOnSixtyDayIl`). See [MLB_OPERATIONS.md](MLB_OPERATIONS.md) §24.

An option clears an active spot only and never a 40-man spot (even one that uses a final option
year). Only the 60-day injured list and a designation take a player off the 40-man. They are
separate constraints with separate, unranked lists grouped by transaction class, each option
carrying its Rights status, which spots it opens, and its consequences. A promotion or a return
is a **chain** of the transactions Player Rights owns plus the clearing each one needs, and is
only as certain as its least certain link. MLB Operations composes prerequisite transactions;
it defines no combined right. `placeOnSixtyDayIl` is `indeterminate` until the injury-length
threshold is measured.

## D-029 — Injured-list activation rules come only from observed OOTP behavior

**Status:** Accepted; the rules themselves are **pending the experiment**
([RIGHTS_RESEARCH.md](RIGHTS_RESEARCH.md) §4.11).

Player Rights does not import real-world injured-list rules. `activateFromInjuredList` stays
`indeterminate` and states the prerequisites the export invariants imply (a spot on the active
roster; from the 60-day list also a 40-man spot), reported as requirements and clearing needs
rather than as a rejection. A transaction the game performed for the club is not evidence of what
a manager may do; a rule is encoded only after two concordant controlled observations.

## D-030 — A role comparison is Player Development's, on one stated lens; the report composes it

**Status:** Accepted. **Implementation:** Present (`server/roleStanding.ts`, `server/mlbReport.ts`).
See [MLB_OPERATIONS.md](MLB_OPERATIONS.md) §27.

"Would he fill the role better than who is there?" is answered from Player Development's
destination fit (visible tool ratings against MLB peers) alone, with the gap that counts as clearly
ahead a provisional calibration parameter. Season results are shown as context and can say a
sample is too thin or that results agree or disagree with the ratings; they never change the
verdict. A player with no visible rating is named, never ranked. The verdict is not a decision:
MLB Operations turns it into a briefing (situation, role picture, read, pathways) and never picks
a move. Pathways are ordered by readiness of the path, not by a score of players. This does not
reverse the earlier rule against ranking candidates by a magic score; it adds an evidenced,
labelled comparison against the incumbents.

## D-031 — A proactive review is a flag with two lenses, never a trigger or a hidden score

**Status:** Accepted. **Implementation:** Present (`server/roleReview.ts`, `server/mlbReview.ts`,
`server/resultsMetrics.ts`, `server/resultsEvidence.ts`). See [ROSTER_REVIEW.md](ROSTER_REVIEW.md).

MLB Operations now reviews role holders unprompted, as a scouting department would. The review reads two
independent lenses, always shown: the organization-visible tools against MLB peers, and results
(league-relative, recency-weighted, with the sample behind them). A **working estimate** blends them for
comparison, weighting results by how far the sample can be trusted, and is always displayed with its
lenses, its weight and its basis. A finding names its case (both lenses weak; tools weak but results
fine; results weak but tools fine; too early), its strength, the competing explanations (luck, sample,
age, results ahead of tools) and what would change the read. Only a strong or moderate case becomes a
`role_holder_review` need; a watch item is shown but is not a need. A finding is never a transaction
trigger and never a decision; unknown evidence is "cannot judge", never weak. Results are objective
statistics and are read directly; ratings still come only through `scoutedEvidence.ts` (D-017). Every
threshold is a provisional calibration parameter declared once.

## D-032 — Replacing a holder is a chain of moves, followed through (cascades)

**Status:** Accepted. **Implementation:** Present (`server/rosterScenario.ts`, `server/mlbPlans.ts`).

Replacing a starter is never one move. A plan is a chain of the moves the rest of the system already
evaluates (bring in, option, designate, 60-day, role change), applied to a club view, with the
consequence per role group (floor, mean and weakest working estimate, before and after), the roster
counts, the natural follow-up move for a group that gained a body, and the Player Rights status of
every link; a plan is only as certain as its least certain link. Legality is Player Rights', ability
is the evaluators', the affiliate effect is Minor League Operations'; the engine is bookkeeping. The
duration of a replacement is not assumed (D-027). With no internal replacement there is no plan.

## D-033 — A hitter is judged on his bat and his glove at the position he plays; the lineup is what usage shows

**Status:** Accepted. **Implementation:** Present (`server/lineupPicture.ts`, `server/platoon.ts`,
`server/roleReview.ts`, `server/mlbReview.ts`). See [ROSTER_REVIEW.md](ROSTER_REVIEW.md).

The regular at a position is the player who has played the innings there; the designated hitter is whoever
starts without a fielding start to explain it; the rest is the bench. A hitter's working estimate is his bat
(visible tools and wOBA, weighted by sample) blended with his REVEALED fielding grade at the position against
MLB peers listed there, by a provisional position weight; a grade the game does not show is never read and is
not assumed bad. Platoon is judged from observed splits shrunk toward the league's own effect for a batter of
his hand; only an effect clearly larger than the league explains counts. Rating splits and running speed are
not approved evidence (D-017) and are not used. A bench player who would improve a spot is a lineup decision,
not a transaction; moving another regular opens a new hole and is not offered.

## D-034 — The staff recommendation is a stated rubric, advice with its reasons and what would change it

**Status:** Accepted. **Implementation:** Present (`server/mlbReport.ts` `recommendationFor`).

A recommendation is ACT, EXPLORE, MONITOR or HOLD, from an explicit rubric over the strength of the case, the
lead replacement's verdict and certainty, whether his path is open and defensible, and whether a plan exists
that puts nobody at risk. It names what must be settled first, what would change it, and where the
replacement is still below the group median. A disruptive move is never an ACT. It is advice: MLB Operations
executes nothing and the GM decides. This refines, and does not reverse, the rule against a hidden score: no
candidate is ranked by a number the GM cannot see the parts of.

## D-035 — A hitter's rating splits and running ratings are approved evidence, through the same adapter

**Status:** Accepted (owner decision, 2026-09-20). **Implementation:** Present (`server/scoutedEvidence.ts`
`loadScoutedHitterProfiles`, `scoutedHitterPopulation`; used by `server/toolsModel.ts`, `platoon.ts`).

D-017 approved the overall and potential tool ratings, stamina and pitch grades, and revealed fielding-position
grades. The owner extended it to two more families, for platoon and baserunning: a hitter's **ratings against
left-handed and right-handed pitching** (`batting_ratings_vsl_*` / `_vsr_*`: contact, gap, power, eye, strikeout
avoidance) and his **running ratings** (`running_ratings_speed`, `_baserunning`, `_stealing`, `_stealing_rate`).

Everything D-017 and D-018 say about the adapter applies unchanged: these are read only in `scoutedEvidence.ts`;
a grade that is absent, non-numeric or not positive is unknown, never averaged around; a composite exists only when
every component is known; ratings are normalized to 20-80; provenance says `declared_organization_visible` and
`not_verifiable_from_export`. Stealing RATE (how often he tries) is reported but never averaged into ability.

What is **not** approved, and is enforced by `tests/evidenceBoundary.test.ts`: pitchers' rating splits, hit-by-pitch
and BABIP ratings, ground/fly and holding-runners ratings, bunt ratings. Each would be a further owner decision.

The evidence earned its place: against 2023 to 2025 results the rating-implied platoon effect has a calibration
slope of 1.06 and beats every other predictor tried, while a hitter's own past split adds almost nothing
(docs/CALIBRATION.md section 4).

## D-036 — Philosophy and the season lean on the advice, after validity, and every lean is shown

**Status:** Accepted (owner decision: philosophy and competitive window are pivotal to the recommendation).
**Implementation:** Present (`server/staffPreference.ts`; used by `mlbReview`, `mlbResponses`, `mlbReport`,
`mlbOperations`). Refines D-019; does not reverse it.

The organization's philosophy and where its season stands are pivotal to how the staff advises: the same facts are
told differently to a contender in the race and to a club that is building. Two inputs, kept apart and both shown: the
**window** (the philosophy's competitive-window dimension: identity) and the **season** (the deadline read's chance of
the postseason: the present). When they disagree the read says so and does not resolve it.

What they may do, and only after validity: raise or lower **how urgently a flag is raised** (never remove one); choose
**among replacements that are already ready and already equivalent** in what they add (a bucket of gain, after
readiness and the verdict); set **how high the bar for "recommend" is** (a contender in the race can be told to act on a
moderate case; a club that is not pressed is told to watch it; a club that is building will not be told to act on a
replacement years older than the holder); order plans; and word the advice. The dimensions read are competitive window,
risk tolerance, age-curve sensitivity, upside preference, defense emphasis, roster depth and pitching depth; the ones not
read (contract and prospect-capital dimensions) are named as such.

What they may not do: change a working estimate, a finding, whether a replacement is an upgrade, a Player Development
judgment or a Player Rights status; make a blocked, indeterminate or incomplete alternative ready; or lean unseen.
Every lean is a `ShadeReason` (which dimension, what value, what it did), and a recommendation that differs from what a
club with no stated philosophy would hear says what that would have been. `tests/staffShading.test.ts` proves the facts
are identical across clubs; `tests/mlbOperationsBoundary.test.ts` proves the ordering (readiness, then verdict, then
equivalence, then preference, then size) and that no MLB module names a philosophy dimension.

## D-037 — Scouting constants are tuned against outcomes, declared once, and stamped

**Status:** Accepted. **Implementation:** Present (`server/calibration.ts`, `scripts/calibrate.ts`,
`scripts/lib/fit.ts`, docs/CALIBRATION.md).

A first-pass constant is a placeholder. The harness predicts later seasons from earlier ones with the production
functions and reports the error for candidate parameters against a no-information baseline; the constants it supports
are updated in their one declaration and stamped `calibrated` with the run; those it cannot support (one partial season
of zone ratings; policy thresholds) stay `provisional` and say why. Ratings-versus-results tests are read on lagged windows
because OOTP formed the ratings from recent real results. Where the tools are known, results are shrunk toward what the
tools imply, so the sample they need is smaller by the share of talent the tools explain. Run 1 changed the season
weights, stabilization constants, pitcher mix, tools lens, platoon prior and shrinkage, and found a nine-fold scale error in the
FIP surrogate (percentiles were unaffected).

## D-038 — Bench, bullpen roles, position shifts and platoon partners are flags and plans, never transactions

**Status:** Accepted. **Implementation:** Present (`server/benchReview.ts`, `bullpenRoles.ts`, `lineupShifts.ts`,
`platoon.ts`; composed in `mlbReview`, `mlbPlans`, `mlbResponses`, `mlbReport`).

A **bullpen role** is what usage shows (closer, high-leverage arm, middle, long man, low-leverage), from leverage cut-offs
on the league's own distribution; it sets the stakes of a weak arm, and a clearly better arm in a lower-leverage role than
a worse one is a deployment finding for the manager, not a roster move. The **bench** is reviewed for what each man is for and
for coverage: a required position (catcher, middle infield, center field) with nobody on the bench who can play it is a
coverage need, filled by the same discovery as any role. A **position shift** fixes a weak spot by moving a regular there
and covering the spot he leaves from within, proposed only when the two spots gain together; it is a lineup decision (no
transaction) and carries a stated comfort cost the estimate cannot see. A **platoon partner** is proposed for a regular whose
platoon problem his ratings support, when a hitter is clearly better against the weak hand; a partner already on the bench is a
lineup decision. All of it is advice with its reasons; the estimate at each position is bat plus glove there, so what a
shift costs in the field is in the number.


## D-039 — A peer population is major leaguers; an amateur signing is not a peer

**Status:** Accepted. **Implementation:** Present (`server/scoutedEvidence.ts`, `tests/mlbPopulation.test.ts`).

Every club carries, under its own `team_id`, the amateurs it has signed: sixteen- and seventeen-year-olds with all-20
tools and no plate appearances, marked by a negative `players.league_id`. Ranked against them a real hitter's tools
percentile was inflated by the share of the pool they made up (60 of 486, 12%, in the Arizona import), and every mean over
the pool was pulled down: the spread of expected wOBA across "MLB hitters" read 41 points where the real one is 18, the glove
peers at each position included the same signings, and `toolsExpected` ("points against the league average") was about 12
points too high. A peer is a player whose own league is the major league (`COALESCE(league_id, league) = league`); an export
with no `league_id` leaves the population as it was (schema-tolerant). Found by the base-rate run on all 30 clubs
(docs/MLB_OPERATIONS_HARDENING.md, F-0); pitchers were never affected (Player Development's population is the active roster).

## D-040 — A concern is measured against the role, not the group and not one absolute line

**Status:** Accepted. **Implementation:** Present (`server/roleStandards.ts`, `roleReview.ts`, `mlbReview.ts`,
`scripts/calibrate.ts standards`, `tests/mlbGoldenHitters.test.ts`, `tests/mlbInvariants.test.ts`).

A working estimate is a percentile among all major-league hitters (or pitchers of a kind), so the same estimate means
different things in different jobs: regular first basemen and designated hitters typically sit at the 73rd to 77th
percentile, second basemen, third basemen and center fielders near the 50th; a long man is expected to be the weakest arm
in the pen and a closer is not. The previous rule (an estimate under 35, or the weakest of the group by 8) flagged a lineup
regular on 25 of 30 clubs, mostly shortstops and center fielders with ordinary bats and good gloves, never flagged a first
baseman with a mediocre bat, and flagged a fifth starter or a long man for being what he is.

A holder is a concern when he is unusually weak FOR HIS ROLE: under the floor, the level below which the lowest tenth of
the league's holders of that role sit (a moderate case when tools and results are each weak for the role), and a strong case
under the deep floor (the lowest twentieth). A hitter's role is the position he plays, a starter's is a rotation spot, a
reliever's is the tier his usage shows. The standard is shown with every finding ("regular left fielders typically 68,
unusually weak under 48"), so the position is never a hidden adjustment; the estimate itself stays position-neutral so a
candidate at the same position is compared like for like. Being the weakest of a group is context, no longer a trigger, and a
finding does not change when another player joins or leaves the group (`tests/mlbInvariants.test.ts`).

The typical levels are descriptive and provisional (the median of the production review across the 30 clubs at one snapshot);
the quantiles are policy. After the change a lineup regular is flagged on 13 of 30 clubs, a starter on about 1 in 15, a
reliever on about 1 in 8, and every flag is one of the league's lowest-twentieth-or-tenth holders of that job.

## D-041 — Every constant is calibrated, provisional or policy, and the three are never confused

**Status:** Accepted. **Implementation:** Present (`server/calibration.ts`; stamps across `server/`).

`calibrated` is estimated from historical evidence and can be right or wrong; `provisional` is a MODEL parameter that ought to
be estimated and has not been (one partial season of zone ratings); `policy` is a product decision about when to raise
something or how loudly, so no backtest can call it optimal, it is chosen, stated, shown and changed by decision, never by
fitting. The concern lines, the platoon margins, the regular and partner shares, the shift thresholds, the bench cover lines
and functions, the deployment gap, every philosophy threshold and the quantiles behind the role floors are policy. The
mechanisms (results are sample-aware, a hitter is bat plus glove at his position, shading applies only after validity) are
architecture and carry no stamp: tests pin them. `npm run calibrate` is not re-run for a policy constant.

## D-042 — The bench is a set of functions with a quality of cover, and the pen is read as a whole

**Status:** Accepted. **Implementation:** Present (`server/benchReview.ts`, `bullpenRoles.ts`, `lineupPicture.ts`,
`lineupShifts.ts`, `platoon.ts`; `tests/mlbGoldenBench.test.ts`, `mlbGoldenPitching.test.ts`, `mlbGoldenLineup.test.ts`).

Standing at a position is not covering it. A cover's visible grade is ranked among the peers listed at the position: regular
quality (about the median), credible (not in the bottom tenth) or emergency (playable, no more), so a middle infielder who
can "play" center field with a first-percentile grade is an emergency cover, not a backup. The bench is reported as
functions, never a score: who covers catcher, middle infield and center field and how well, a bat to send up, a glove for
late innings, a runner, flexibility, a platoon partner. Only a hard gap (nobody has a visible grade) is an attention item;
an emergency-only cover is a finding on the Bench view, because half of the league's benches are thin at center field and
raising it would not say which club has a problem. The lineup names a regular at one spot per man and a partner where two men
share it. The bullpen adds pen-wide findings (no credible high-leverage arm, nobody throwing multiple innings, a crowded role)
and a rotation/bullpen conflict on tools alone, each stating what the pen appears to be doing, what the evidence supports and
why the difference matters. A shift is offered only when it beats simply starting a bench player at the weak spot. Platoon reads
say what drives them (league norm, ratings, record) and never report "no issue" on the strength of the league norm alone.

## D-043 — MLB Operations is a workspace of views, each owning one question

**Status:** Accepted. **Implementation:** Present (`src/pages/MlbOperations.tsx`, `src/pages/mlb/`;
docs/MLB_OPERATIONS_HARDENING.md section 8).

One page had accumulated the inbox, the scouting book, every candidate and every roster mechanic, and the list of what needs
attention sat under all of it. The module is now five views behind one navigation entry, addressable by URL hash so a decision
can be linked to and returned to: **Overview** (what needs my attention: an operational inbox, a one-line reading of the club,
summary cards, no tables of players), **Position players** and **Pitching staff** (the scouting book: each player against the
standard for his job, expandable to what a scout would say), **Bench and coverage** (functions, not a score) and **Decision**
(one need opened, in the order a GM decides: the problem, why it was flagged and on what evidence, the staff's recommendation,
the ways to respond followed through to their consequences, and only then the candidates and roster mechanics behind them).
Information becomes more detailed as the GM drills down; nothing was deleted.

## D-044 — The farm asks whether the assignment is defensible, not whether a promotion was earned

**Status:** Accepted. **Implementation:** Present (`server/currentAssignment.ts`, `farmAssignments.ts`,
`farmResults.ts`, `playingTime.ts`; `server/prospectDecision.ts` age rule; the legacy verdict removed from
`org.ts`). Audit and findings: [MINOR_LEAGUE_OPERATIONS.md](MINOR_LEAGUE_OPERATIONS.md).

The farm system is not a promotion leaderboard. Good statistics are not authorization to promote and poor
statistics are not authorization to demote. The question is whether where a player is, in the role he is in,
getting the work he is getting, is developmentally defensible — and if not, what else is.

The farm v1 model could only ask the second question, through one readiness score that was in practice
"is his OPS well above his level's average", so the only thing it could say about a player standing still
was to recommend moving him. Five things follow, each of them a measured defect on the real import:

- **A level is not a peer group.** Production is read against the player's own LEAGUE, park-adjusted, with
  the sample behind it (`farmResults.ts`). Pooling leagues put the two Arizona A-ball affiliates 43 OPS
  points apart on the same baseline and rested the Rookie baseline on two players of a league Arizona does
  not field a club in. A peer must also be on a roster: 148 unassigned amateur signings put the major-league
  level's average age 1.77 years out, the same defect as D-039 and the same fix.
- **Age never lowers the developmental bar.** Being old for a level is not evidence about what a player has
  shown. The old rule discounted his promotion threshold by up to five points for it, which made a
  29-year-old hitting 1.304 at Double-A a promotion case on a bar of 71. Age says how much developmental time
  is left, so a player past his level's window raises an **organizational** question — what the club wants
  from him — and Player Development says so rather than recommending a move.
- **"Is this level still developing him?" is a separate Player Development question** with its own two
  readings, level standing and developmental window, both always shown. Holding his own is the null reading;
  moving off it needs a clear gap and a sample that supports a claim. A season that has not been played is
  `not_assessable`, which is distinct from `indeterminate`: nothing is missing that scouting could supply.
- **Playing time is a first-class operational concept**, represented as a named set of players competing for
  a named job with what each is getting, never as a score. One man competes for ONE job — the one his usage
  shows he holds — because versatility is cover, not five developmental claims. Missing reps costs
  development only for a player Player Development places at development priority or better, and unknown
  stakes claim nothing. Not playing is asked BEFORE the level, because a prospect's thin sample is usually
  caused by his not playing and the two facts are one fact.
- **One Player Development verdict, not two.** `org.ts`'s `signal` (`OPS above the level average by .075
  over 100 plate appearances` was a promotion) and `score` (which ordered the list) are removed. They were a
  second verdict beside the engine, disagreeing with it for 6 of 75 players, and the Dashboard counted every
  non-null value — including `watch` — and announced "Promotion signals: 42" for an organization whose farm
  system proposed nothing. The statistics themselves are objective facts and stay.

Consequences:

- A conclusion is one of eight descriptive states and never a promote/hold/demote trichotomy; most of the
  organization is `current_assignment_defensible` and the module says so rather than inventing a question.
- Every farm constant is declared once in `server/farmCalibration.ts` and stamped `policy` or `provisional`;
  none is `calibrated`, because the export holds no minor-league history to fit against, and that is stated.
- Every player on an affiliate's active list is reasoned about. One with no readable line is reported as
  not assessable WITH THE REASON, never omitted: the old sample gates silently hid 172 of 247 minor leaguers,
  including all 125 on the three complex affiliates.
- A finding is structured data (`FarmFinding`: owner, evidence with its basis, what is missing, what would
  resolve it), never prose. `tests/farmOperationsBoundary.test.ts` enforces the module's boundaries and
  `docs/BEHAVIOR_CASES.md` carries the corpus.

## D-045 — Minor League Operations owns the farm consequence; MLB Operations displays it

**Status:** Accepted. **Implementation:** Present (`server/farmCascade.ts`, `farmOperations.ts`
`farmConsequenceFor`, consumed by `mlbEvidence.ts` `farmConsequence`).
See [MINOR_LEAGUE_OPERATIONS.md](MINOR_LEAGUE_OPERATIONS.md) Part 3.

MLB Operations and Minor League Operations are sibling consumers of one set of specialists, and they exchange
consequences across one explicit contract. "What happens to the farm if this player leaves?" is asked by MLB
Operations and answered by Minor League Operations, which owns the calculation.

- The answer is structured: the job he vacates, whether the affiliate can absorb it, whose playing time
  changes, the replacements Player Development would allow in readiness order, the **cascade**, what the
  chain leaves open, and how certain the answer is with how it was measured.
- A cascade is a chain, not a search. Each step is independently defensible or the chain stops there, and it
  is only as certain as its least certain step: one indeterminate link makes everything downstream
  indeterminate, and an indeterminate best candidate stops the chain rather than falling through to a worse
  but judgeable man. It stops when the club can absorb the vacancy, when no defensible move exists, when the
  next step cannot be judged, when the chain would only relocate the same shortage, at the bottom of the
  ladder, or at four steps. **Saying where it stopped is the answer**: "the recall is feasible, and Double-A
  is left short at the rotation" is the intended output, and nothing manufactures a last step to complete a
  chain.
- **An unresolved farm consequence is information, never an illegality.** Whether a transaction is possible
  is Player Rights'; nothing in the contract touches it.
- A rehab assignee costs the affiliate nothing and the answer says so (D-026).
- The direction is enforced statically: no MLB module but the adapter may import a farm module, and none may
  contain a chain planner of its own. This is why the old branch's `minorLeagueCascadePlanner` was deferred
  rather than adopted (MLB_OPERATIONS.md §2.1 item 12) — it was a second farm solver inside MLB work.

Consequences:

- Retention is split three ways with three owners, and philosophy may not reach the developmental outlook.
  The farm v1 model added a philosophy adjustment to a development score which then gated a release
  threshold, so the same player was expendable at one club and retained at another inside a quantity
  labelled "development". Philosophy is now a stated lean on the order and wording, applied after the
  outlook is fixed, which can never turn a `retain` into a question. A decision belonging to another process
  — the 40-man, a major-league contract, an injured list — is `not_a_farm_decision` and names the process
  that owns it, while still reporting the farm's own reading.
- Operational health and developmental health are separate outputs of an affiliate and are never merged.
  Only a SHORTAGE is an operational state: carrying more men than the club has work for is a developmental
  problem, and reporting it as `surplus` in the same field as `critical` is what let an affiliate with
  twenty-three relief arms read as fine.

## D-046 — Minor League Operations is a workspace of views, in the family of MLB Operations

**Status:** Accepted. **Implementation:** Present (`src/pages/MinorLeagueOperations.tsx`, `src/pages/farm/`).

The farm module is five views behind one navigation entry, addressable by URL hash so a decision can be
linked to and returned to: **Overview** (the inbox, and nothing else), **Organization** (system-wide
congestion, depth and starters against rotation spots), **Affiliates** (one club read twice, operational
beside developmental), **Assignments** (every minor leaguer, filterable to those in question, ordered by
whether the GM needs to look and then by name) and **Decision** (one player in the order a GM decides).
The same information architecture as D-043's, for the same reason.

Family resemblance is structural rather than imitated: the shell, the tab bar, the view-error boundary, the
hash-routing shape and the chip vocabulary (the `eligible` / `ineligible` / `indeterminate` colouring,
ordinals, the uncertainty language) are imported from `src/pages/mlb/`, not re-implemented. What differs is
what the farm talks about, not how it talks, and screens are not cloned where the baseball workflow differs:
the farm has no bench view and MLB has no affiliate view.

The Overview carries each player's own assignment review and each club's OPERATIONAL findings. A
developmental finding about named players is the same problem those players' own reviews already raise, and
carrying both made the list 137 items, half of them a second copy of the other half; those findings live on
the Affiliates view, where the GM has drilled in deliberately.

## D-047 — One description of the farm: a blocker holds the job, the organization is read once per request, and MLB Operations shows the farm's own reading

**Status:** Accepted. **Implementation:** Present (`server/playingTime.ts` `blockersOf` / `alsoPlaying` / `bat_only`,
`minorLeagueRoster.ts` injured treatment, `farmOperations.ts` `FarmSession` and `affiliateOperationalUnder`,
`farmConsequence.ts`, `mlbEvidence.ts` `farmConsequence`). Findings: [MINOR_LEAGUE_OPERATIONS.md](MINOR_LEAGUE_OPERATIONS.md) §7.5.

The hardening phase found the farm describing the same club two ways and the same prospect's problem
by the wrong name, each a measured defect on the real import:

- **A blocker holds the job.** "Blocked by" named anyone with more innings than the prospect, so a
  centre fielder with a fifth of the club's innings was "occupying the developmental path" of the man
  behind him. Only a REGULAR at the job is a blocker (`blockersOf`); when nobody is regular the
  prospect's problem is real and is an opportunity conflict, not a blockage by a name. Men taking
  innings at the job from another position — a corner outfielder covering centre, a two-way pitcher
  who is in fact the regular first baseman — are named as ahead (`alsoPlaying`) and count against
  nobody's claim: one man still competes for one job. A designated hitter is `bat_only` — batting,
  not fielding — which is a quieter finding than not playing and no finding for a depth player. A
  player injured for more than a week (`INJURED_DAYS_NOT_COUNTED`) is not cover, takes no starts and
  competes for nothing; his review says he is injured.
- **The organization is read once per request, and never longer.** `farmConsequenceFor` re-read the
  organization per call and MLB Operations called it per candidate: ten Triple-A candidates cost
  eleven seconds. A `FarmSession` memoizes the three reads (assembled players, Player Development's
  payload, roster health) for the life of one request; MLB Operations opens one and hands it through
  the adapter. Nothing is served across requests, exports or philosophy settings: correctness and
  freshness are not traded for the cache.
- **MLB Operations displays the farm's own reading.** The adapter reported a role-code status that
  called Reno `thin` while the farm workspace, counting six men taking starts, called it able, and it
  never displayed the v2 answer at all. `overall` and `issuesAfter` are now the farm's
  findings-derived operational reading before and after the move (`operationalReading`, shared with
  the Affiliates view), the change lines count what the move touches, and the Decision view and staff
  report carry the farm's sentence, the replacements with philosophy's preference, and what is left
  open. The arrival direction (an option) is answered too: the job he takes up, who holds it, whose
  developmental work is pushed aside — the conflict that would exist with him on the club.
- **A pool Player Development has not evaluated leaves a cascade indeterminate**, and says how many
  were ruled out and how many were never looked at; `no_defensible_move` means every candidate was
  judged and ruled out, or there was nobody.
- **An open developmental runway is a development case** whatever this season's line says: it is a
  fact about age and level. Retention reads it before the line.

Consequences: the superseded solvers, their routes and the three older farm pages are deleted, so
exactly one farm implementation exists; `minorLeagueRoster.ts` is counts and coverage and decides
nothing (its `overall`, role-code statuses and prose lines are gone); the Player Development pages
read `/api/scouted-development`, which is Player Development's and history's; the Dashboard counts
the farm's own attention list and the AI briefing receives the farm's structured conclusions rather
than an alphabetical head of the prospect list.

## D-048 — Season usage, recent usage and current state are three kinds of fact, and only current state says who is here

**Status:** Accepted. **Implementation:** Present (`server/farmRecentUsage.ts`, `server/clubArrival.ts`,
`farmUsage.ts` `clubGameLogs` / `lastGamesElsewhere` / `injuryAbsences` / `projectedRotation`,
`playingTime.ts` `WorkShare` / `ConflictTiming` / `GoneHolder` / `jobRead`, `farmOperations.ts`
`jobWindowFor` / `castOf` / `pitcherJob` wiring, `farmConsequence.ts` `currentOpportunity`). Findings:
[MINOR_LEAGUE_OPERATIONS.md](MINOR_LEAGUE_OPERATIONS.md) Part 8.

Season-to-date playing-time totals can describe a competition that no longer exists. On the real import
a wave of promotions four games before the export made every promoted prospect read as "cannot get the
work" at his new club, and **all seven of the farm's pressing blocked-prospect findings were that
artifact**; across thirty organizations 217 such findings became 37. The hardening phase had recorded
recency as roadmap work on the assumption that the export held no game-level data. It holds a complete
per-game batting and pitching log for every minor-league level, which reconciles with the season tables
exactly.

- **Three kinds of fact, kept apart.** *Season usage* is what happened this year: context, always
  shown, never deleted. *Recent usage* is what happened over the club's last fifteen games: evidence of
  the present role. *Current state* is who is on the club now and available — the roster, Player State,
  the rehab screen, the injury columns — and it is **never inferred from usage**. A man with 136 innings
  who is not on the roster competes for nothing. Measured: restricting the season to men still on the
  club is worth about twice what any window adds.
- **A man's current work level is the recent read when it can be read**, the season's when the export
  has no game log, and `unknown` when there is a recent read too thin to establish a role. History is
  never allowed to stand in for a present it does not describe; nor is it erased — a conflict the season
  shows and the recent games do not is kept, quietly, as `historical` or `recently_resolved`, with
  nobody in it `squeezed`.
- **Thin is not unused.** Fewer than `RECENT_MINIMUM_GAMES` observable games is `thin`, the role is
  `unknown`, and an unknown role is neither squeezed nor a blocker. Evidence is a structured state
  (`sufficient` / `thin` / `none`), never a confidence number. Less evidence may only ever mean more
  uncertainty.
- **The window is cut once per way a competition changes.** A man who arrived, or came back from an
  injury, is measured only over the games he could have played in. When a man who HELD the job leaves
  it — a regular's share of the window up to his last appearance for the club — everyone is measured
  from the game after his last start there. Anyone else not competing who took starts there, a rehab
  assignee above all (D-026), has those games set aside.
- **A departed man is never a current blocker**, whatever his season total, and raising that total
  cannot restore him. He is named, with what he held and where he is now, as history.
- **An arrival is dated by chronology, in D-020's order**: OOTP's transaction log first, through
  `clubArrival.ts` — the farm never reads the log itself, and an event counts only if it names the club
  the EXPORT has him on; then the game log's bound; otherwise it is not established and is said not to
  be. The log dated all 63 of one organization's in-season arrivals and the game log 24 of them.
- **For a rotation the export states the present**, and an exported fact about now outranks a usage
  read of the past: a man among OOTP's next five starters whose usage has not caught up holds a spot on
  current state, and one whose sufficient usage contradicts it is a role change under way, never a man
  blocked from starting. No such source exists for a hitter.
- **The window is games, not days, and one length serves every job — with two differences the evidence
  required.** The rotation has its own lines, because three turns fit in fifteen games. And **a relief
  window may confirm or clear a shortage but never raise one**: a reliever's innings share correlates
  0.31 window to window against 0.57 for a position's starts, and a fifth of the arms that were not
  short in one window read as short in the next.
- **A disagreement is two or more levels apart**, and then both reads are shown and neither is silently
  chosen. One level apart is a fortnight's noise on a club that moves men through positions.
- **A man's own opportunity does not depend on somebody else wanting his position.** A lone claimant
  who is not playing is read as not playing.

**What it may not do.** Recent usage is a usage read. It is never a performance read, never a "recent
form" score, and never promotion or demotion authorization: `currentAssignment` takes no usage input and
no Player Development module imports the window. Philosophy names no dimension in any usage module.
Retention takes no usage input; low recent usage is never a release rule. A cascade step still needs
Player Development's own authorization — recent usage can change an operational consequence and can
never make an indefensible assignment defensible. MLB Operations receives `currentOpportunity` through
the existing contract and reconstructs nothing (D-045).

**Stamps.** `RECENT_WINDOW_GAMES` (15), `RECENT_MINIMUM_GAMES` (6) and `RECENT_ROTATION_SHARE` (0.6 /
0.3) are **provisional**: backtested on the export's own game log (`npm run farm:usage-window`), on one
partial season of one save, with the result flat between twelve and fifteen games. The three kinds of
fact, the window rules, thin-is-not-unused and relief's confirm-or-clear are architecture, and tests
pin them.

Consequences: `DEPARTED_SHARE_NOTED` and its note survive only for an export with no game log, where
they are still all that can be said. The protection tier is untouched: who can be squeezed is decided by
it, and its peer-relative refinement is the next branch's.

## D-049 — Pennant has its own name, version lineage, application id and tag namespace; one inherited identifier is held on purpose

**Status:** Accepted; amended 2026-09-21 (owner decisions on the application id, the author and the tag convention).
**Implementation:** Built in the project-consolidation phase ([PENNANT_CONSOLIDATION.md](PENNANT_CONSOLIDATION.md)). No
baseball behavior changed.

The project began as a fork of `lsukev/ootp-front-office` at upstream's `0.27.2` and has since become a different
product with a different architecture. Taking that seriously means giving it its own identity everywhere that renaming
is free, and not renaming the one thing where it is not.

- **The product is Pennant.** Every surface a user sees says so: the application, installer, window, browser tab,
  README and CHANGELOG. Upstream stays credited, prominently, in the README, the changelog, the Help menu, the license
  and `docs/upstream/`; nothing implies Pennant's code was all written here or that upstream endorses it. The package
  author is Dakota Wise; upstream's copyright notice stays in `LICENSE` and the build's `copyright` line.
- **Version lineage restarts at `0.1.0`.** Inheriting `0.27.2` implied Pennant was upstream's next release, and
  upstream has since shipped through `0.40.1`. `0.1.0` means "the first Pennant-native version", not "the first code
  in this repository", and stays below 1.0 because several models are provisional. `package.json` is the only source
  of the number: the server reads it (`server/appInfo.ts`), Electron hands it over when packaged, `/api/status` serves
  it, the header shows it, and a test fails if the lockfile or the changelog disagrees. No upstream tag was renumbered,
  moved or deleted, and no history was rewritten.
- **The application id is `com.dakotawise.pennant`.** It is the macOS bundle id and the Windows install identity, and it
  was upstream's `com.lsukev.ootpfrontoffice`. It is Pennant's own and identifies the author, not the project it began
  as. It was changed while it was free to: `origin` has no tags and no GitHub releases, so no installer with the old id
  exists in the wild, and the only cost of a new id (macOS re-asks for folder access; a new install sits beside an old
  one) falls on no user. It is not what names the user-data folder (Electron uses the package name; checked), so it does
  not touch the hold below; whether the API-key keychain entry follows the app name or the bundle id was not verified.
  It must not change again once an installer is published.
- **Release tags are `pennant-v<package version>`** (`pennant-v0.1.0`), never a bare `v<version>`. Upstream's tags
  (`v0.1.0` … `v0.40.1`) have the same shape as a `v*` Pennant tag, so a `v*` convention would collide with them in any
  clone that also fetches the `upstream` remote's tags, and the release workflow's trigger would match them. The
  workflow triggers only on `pennant-v*` and refuses a tag that is not `pennant-v` + `package.json`'s version. The
  prefix is in `server/project.ts` (`RELEASE_TAG_PREFIX`), `release.yml` and `electron-builder.yml`
  (`publish.tagNamePrefix`), and a test keeps them in agreement. The application-visible version stays `0.1.0`.
- **The desktop updater and every in-app link name Pennant's repository**, from one constant (`server/project.ts`), and
  the feed is stated in `electron-builder.yml` rather than inferred from a git remote.
- **One inherited identifier is held, pinned by `tests/projectIdentity.test.ts`: the npm `name` (`ootp-front-office`).**
  Electron derives the desktop user-data folder from it, not from `productName`: the packaged app's bundled
  `package.json` carries `name` and no `productName` (checked in a real build's `app.asar`), and the owner's existing
  desktop data lives in `~/Library/Application Support/ootp-front-office` (2.5 GB). Renaming it points the app at a new,
  empty folder. The OS keychain entry that protects a saved API key is presumed keyed to the same application identity;
  that was not verified and is treated as a hazard. There is no migration, and none is attempted. The release asset name
  is spelled as a literal (`Pennant-<version>-<arch>.<ext>`) so this hold does not leak into what users download. The
  `OOTP_FO_*` environment variables and the `data/` layout are user configuration and persisted state, kept for the same
  reason.

**Updater and tags.** The updater does not need a `v` tag. On a stable version it asks GitHub for the latest release,
downloads from whatever tag that release has, and reads the version from `latest*.yml`; the tag is an opaque string in
the download URL (checked in `electron-updater` 6.8.9). One limit: a *prerelease* version (`0.2.0-beta.1`) puts the
updater in a mode that requires the tag itself to be valid semver, which `pennant-v…` is not. Pennant uses plain
`X.Y.Z` versions until that is solved.

**Amendment, 2026-09-21.** The first version of this record held the application id back and kept `v<version>` tags. It
said the updater requires `v<version>` tags and therefore no Pennant prefix was available; that was wrong (see above)
and the tag paragraph was rewritten. The application id was to be "decided with macOS signing"; the owner decided it
now, before any installer existed, and chose `com.dakotawise.pennant`. Also recorded: the author is Dakota Wise, and the
tag convention is `pennant-v<version>`.

**Not decided here.** Renaming the GitHub repository (`ootp-front-office` → something Pennant-shaped) is the owner's
call: GitHub redirects the old URL, but clone URLs, the `remote`, the `publish` block, `server/project.ts`, the
`package.json` `repository` and every link would follow. A data-directory or package-name migration is a separate piece
of work. Vector brand masters, a macOS icon variant and the Apple signing secrets are owed by the owner.

## D-050 — The protection tier is developmental stakes: an absolute ceiling, lowered by how much development is left

**Status:** Accepted. **Implementation:** Present (`server/developmentFit.ts`, `server/developmentalContext.ts`;
every caller through a reader; `scripts/stakes-report.ts`). Audit, measurements and validation:
[DEVELOPMENTAL_STAKES.md](DEVELOPMENTAL_STAKES.md).

The tier answers one question: **how high are the developmental stakes if the organization mishandles this
player?** It is a reason to look harder when a man is not playing, to be slower to use him as temporary
major-league cover, and not to treat him as a body. It is not whether to promote, demote, start, call up, trade or
release him, and it is not a rank, a trade value, a readiness read or a read of how he is hitting. A core prospect
can be ready for promotion; an organizational-depth player can have a defensible major-league assignment and be the
best man on his club. Organizational depth says his development is no longer what is at stake.

The model it replaces was an absolute 0–100 composite written against OOTP's printed Overall and Potential. D-017
rightly replaced that input with the adapter's far narrower composite and the cut-offs were never re-anchored, so on
the real import **no player in thirty organizations was a core prospect and 53 of 6,411 were protected**; it read
age as a tenth of a score, so a 19-year-old five years young for Double-A and a 25-year-old at Triple-A with the same
ratings shared a tier (2,250 players sat in such groups); youth and a wide gap made 43–48% of 16- and 17-year-olds a
development priority whatever their ceiling; and a high rating made 50 major leaguers aged 27 or more, Freddie Freeman
at 36 among them, players with developmental stakes.

- **The anchor is absolute.** The ceiling is the player's own organization-visible potential read against three
  lines — the composite of the weakest tenth, the median and the best tenth of major leaguers of his kind — held as
  provisional constants, kind-aware because the composite is. It is never a percentile among the players around
  him, so a weak cohort cannot manufacture a prospect and a strong one cannot erase one.
- **Context says how much of that ceiling is still in play, and may only lower it.** Development remaining comes
  from age; it is shortened when he is behind his level's schedule (D-044's lines, against the ROSTERED players of
  his own LEAGUE) and when what the scouts project has already happened. The tier is the ceiling lowered one step for
  each step by which that development has run out. Youth is not talent, and being young for a level raises nothing:
  a level is an assignment the GM controls, and an upper level's rostered average is inflated by veterans.
- **One peer population, for one purpose:** a league's rostered average age. Below the minimum population the
  level's pool is used and said to be; with neither, the schedule is not read and nothing is discounted, because
  missing context may never lower a man's stakes. Missing ratings or age leave the tier unknown (D-018).
- **No result, no usage, no roster need and no philosophy is an input** (D-019). A hot month cannot raise a tier and
  a cold one cannot lower it, because neither is read. Development history is not read: the save holds one snapshot,
  the snapshot composite is not the adapter's, and OOTP's own collapsing projection already carries a plateau.
- **There is no score.** The output is the tier, its reasons and the two readings it was composed from, plus what
  the superseded composite would have said and why it differs, which decides nothing.
- **One way to compute it.** Every production caller obtains a tier through `developmentalContext.ts`, per request,
  so one man has one tier whichever module asks; MLB Operations' contextual assessment is handed the same context
  and reads the tier without being able to change it.

Consequences: the vocabulary and every consumer's semantics are unchanged (`hasDevelopmentalStakes`,
`PROTECTED_TIERS`, `STAKES_WEIGHT`). On the real save no current-assignment verdict, opportunity read, operational
finding, retention conclusion, durable-role judgment or cascade step moved; what moved is who the findings are
about. `farmArrivalFor` reads a job whether or not it is contested, because who holds it must not depend on the
arriving man's tier. `tests/developmentalStakesBoundary.test.ts` enforces the boundaries.

**Stamps.** The ceiling lines, the age bands and the projection line are **provisional**; what the lines stand for
(tenth, median, best tenth) is **policy**; the lookup, "context may only lower" and the null discipline are
architecture. **None is calibrated, and none can be from this export.** The line with the largest effect — a fringe
ceiling with most of his development ahead counts as having stakes (803 of 1,021 priority players) — is policy and
is the owner's to move.

**Hardened (same branch, same day).** `mlbAssignmentContext.ts` is handed the reader's `DevelopmentProtection` and
no longer takes the ratings, so `evaluateDevelopmentProtection` has one production caller; a null age is an unknown
age (`knownAge`), never `Number(null)`; the farm's "how old is he for his league" comes from the same reader; the
dead position-assignment fit and tier-strictness helpers are gone; every reading ends by saying how its two parts
made the tier. Adversarial sweeps found no discontinuity: one birthday or one potential point moves the tier at
most one step and never up. Record: DEVELOPMENTAL_STAKES.md Part 9.

## D-051 — "Short of developmental work" is one line, drawn once, and the club and the man read it together

**Decision.** A man is short of his job when he is `not_used` or `occasional` at it — `shortOfWork` in
`playingTime.ts` — and that is the only line. A `part_time` man is SHARING the job; a `bat_only` man is batting and
not fielding. Every job's conflict (position, rotation, bullpen) decides `squeezed` from that line, and the man's
own review decides "he is not getting the work" from the same line through `shortOfWorkVerdict`, whose agreement
with `shortOfWork` for every level of work a test proves.

**Why.** The position conflict alone had counted `part_time` and `bat_only` as squeezed while the rotation and the
bullpen had not, so an affiliate raised a critical "not getting developmental work" for a sharing prospect in the
same view where his review said sharing is ordinary, and for a designated hitter whose bat was getting its work.
Across thirty organizations 99 of 125 "squeezed" men had reviews that found nothing wrong; with the one line,
`squeezed` is 26 and not one review's conclusion or attention level moved. The affiliate view was the one out of step.

**Consequences.** A sharing prospect and a DH-ing prospect still reach the attention list through their own reviews
(routine, and worth a look). A club-level shortage means a man is not getting the job. Any future work level is
placed on one side of the line, in one place. `farmConsequenceFor` reads a departed man's job whether or not it was
contested, as `farmArrivalFor` already did (B-1), so a departure names the man left sharing the job.

## D-052 — Player Value is a specialist that describes and never authorizes, in wins first and the save's own dollars

**Status:** Accepted 2026-09-22, with the owner's answers in PLAYER_VALUE.md Part 12. **Implementation:** Absent
(phase 0: design and research only). Design: [PLAYER_VALUE.md](PLAYER_VALUE.md). Research evidence:
[PLAYER_VALUE_RESEARCH.md](PLAYER_VALUE_RESEARCH.md). Refines D-002 and D-017 for the pre-fork value surfaces and
applies D-018, D-023, D-036 and D-041 to them.

Every value surface in Pennant (contract advice, payroll control, the trade desk, free agents, the organization
comparison, the player card, the AI trade context) rests on OOTP's `players_value` figures, which D-017 prohibits as
evidence. Contract advice cuts a percentile of them at 70 and 75. The trade desk sums them. A missing arbitration or
free-agency rule becomes 3 or 6 years, and a missing service time becomes zero. No price of a win, cost path or
surplus exists.

- **A specialist that describes.** Player Value answers what a player costs, under what control, what he will
  produce, what a win is worth and what is left. It never says trade, release, extend, sign or promote. It reads
  ability only through `scoutedEvidence.ts`, service and state through Player State, roster rights and
  arbitration and free-agency eligibility only as `playerRights.ts` states them (eligibility joins Player Rights
  under D-023; Player Value owns only the cost band for each status), and never reads the protection tier, Player Development's defensibility or
  philosophy. Player Development and developmental stakes never read value.
- **Five concerns, kept apart:** contract facts; the control and cost path (pre-arbitration, arbitration, free
  agency, as three-valued statuses with a cost band each); expected production; Club Finances (the league's regime,
  price of a win and replacement level, and the club's budget, payroll, revenue, market, cash and owner expectation);
  and surplus. Each has its own output and names its own unknowns.
- **A decomposed, stated estimate, never a hidden score.** Value is reported as bands with their basis and every
  component visible. Thinner evidence (a longer horizon, fewer results, partial ratings) only widens a band. No
  widening is applied to other organizations' players while the export cannot measure that asymmetry. A missing rule, service time or salary is `indeterminate` or `unknown`, never
  a default. Nothing is ranked by a single number.
- **Wins are the unit, and dollars come from the save from import one.** Production is in wins, in the units of the
  export's own WAR. The opening price of a win is salary above the minimum over the WAR of free-agency-eligible
  players, shown with its basis and a wide band. On the Arizona import that is about $7M a win, band $6M–$10M,
  floor $4.3M. It tightens only as observed signings accumulate across imports, and the measured price
  replaces it once the measured band is narrower. Replacement starts at the level the
  export's WAR implies (.288–.293), stamped provisional. A league with no financials is valued in wins, and its
  dollars are `unknown`.
- **Two prices of a win.** The league market price (what a win costs to buy) and the club's marginal value of a win
  (what one more win is worth to this club now, from its competitive position) are both facts. The second is a club
  fact, not philosophy, and is stated in playoff odds until the save can link odds to money.
- **Philosophy is a visible lens, after a neutral valuation.** The neutral value is computed without philosophy and
  cached per import. The lens is applied at read time and shown beside it as "our view", with every lean named
  (the D-036 pattern). It never changes a fact, a band, a price, a control status or an unknown.
- **Personality traits are known facts** where the export gives them. Nothing on this save marks one as unknown.
  They are shown as evidence and move no price until their effect is observed.
- **Sunk money never argues for keeping a player.** The retention view compares keeping him with not keeping him.
  Money owed either way cancels, money already paid appears in neither, and a large remaining guarantee cannot make
  keeping him look better.
- **One computation.** Every player in the league is valued once per import, lazily or warmed after the import, in a
  disposable store keyed by the import. The market figures are snapshotted per import into `history.db` so drift is
  visible (D-009). There is no timer. Every consumer reads the same value through one module.
- **Replace, don't run in parallel.** Each consumer (Contracts, Payroll, Trade Center, Free Agents, Org Comparison,
  then the player card and the rest) moves to Player Value in the same change that deletes its `players_value`
  reads. It shows facts only in the meantime rather than keep an invalid verdict. At the end no production module
  reads `players_value`.

Consequences: `valuation.ts` and `leagueRules.ts` become one `LeagueRules` with every column guarded and the regime
resolved through the parent league (phase 1). `SERVICE_DAYS_PER_YEAR` becomes the league's `rules_min_service_days`.
`tests/playerValueBoundary.test.ts` enforces the boundary from phase 1. New baseball behavior starts in
BEHAVIOR_CASES.md "Player Value".

**Stamps.** Every constant is registered in PLAYER_VALUE.md Part 11. The opening replacement level, the opening
price band and the arbitration ladder are **provisional**. What counts as a market contract, the discount rate, the
horizon, the evidence needed to replace the opening price, the personality bands and the lens weights are
**policy**. Production constants are to be **calibrated** against the export's WAR history in phase 3. Bands only
widen, the lens comes after the neutral value, sunk money cancels and unknown is never a default: that is
architecture, pinned by tests.

**Owner answers** (PLAYER_VALUE.md Part 12):
- Arbitration and free-agency eligibility live in Player Rights; the cost for each status lives in Player Value.
- No widening for other organizations' players until it can be measured.
- The horizon runs to the end of control, capped at 7 seasons, with one stated policy discount rate.
- The measured price replaces the opening one when its band is narrower.
- A minor-league $0 salary is `unknown`.
- The club's value of a win is in playoff odds for now.
- Personality prices nothing until its effect is observed.
- The Trade Center may show the difference between the sides only as a band with its components.
- Minor-league WAR is not used in phase 3.
- Player Value is routed in `AGENTS.md` from phase 1.
