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
history is present; since Player Value phase 6 (D-052) no module reads
`players_value`: the pre-fork trade, contract, franchise and roster surfaces read
Player Value or the adapter, and the boundary test has no allow-list (phase 6e).

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
composite. The Roster's rating bars (`api.ts` `RATING_SPECS`) read the approved
tool-rating columns directly rather than through the adapter: the adapter does not
expose a pitcher's batting grades or a hitter's pitching grades, and reads a 0 as
unknown, so routing them is an owner question (PLAYER_VALUE.md Part 9, phase 6e).
No module reads `players_value` any longer (D-052, phase 6; the boundary test's
allow-list is empty since phase 6e). Fielding-position grades are assumed to
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
  agrees with everything observed and is labeled as such. `owner_attested` (the
  owner's statement of how OOTP behaves) was added for Super Two on 2026-09-22
  (D-052).
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
`scripts/lib/fit.ts`, docs/CALIBRATION.md). **Amended by D-053:** for new work, "calibrated" means fitted on the save's own
outcomes, automatically, with the run record as the stamp; the constants below are not yet migrated.

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
`platoon.ts`; composed in `mlbReview`, `mlbPlans`, `mlbResponses`, `mlbReport`). **Amended by D-053 (cycle 3, 2026-09-25):** the
leverage cut-offs are policy on the league's own leverage scale; the long-man line is measured per save.

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

**Amended 2026-09-24 (owner decision; D-053 cycle 1).** The typical levels and gaps are measured per save at each import and served
once checked (D-053). Each lens has its own line: a holder's tools, or his results, are weak for the role when they sit under the
role's median on that lens less the group's pooled lens gap (the 10th percentile deviation, pooled across the group's roles as the
estimate's is: roughly the lowest tenth of the role's holders on that lens), measured on its own scale, not against the estimate's
typical bat less the estimate's gap.

## D-041 — Every constant is calibrated, provisional or policy, and the three are never confused

**Status:** Accepted. **Implementation:** Present (`server/calibration.ts`; stamps across `server/`). **Amended by D-053:** a
`calibrated` value is fitted per save and stamped by its run record; code keeps the method, the policy and a
provisional fallback prior. Cycle 3 (2026-09-25) restamps the platoon margins and the leverage cut-offs as policy, and splits
"multiple innings" (policy) from the long-man line (a per-save measurement).

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
  none is `calibrated`, and that is stated. (Corrected 2026-09-25, cycle 4: the reason given here, "the export holds no
  minor-league history to fit against", was wrong. The export holds minor-league stat lines for every affiliated level; it
  holds no minor-league ratings history. The sample constants are fittable per save and are not fitted yet: ROADMAP.)
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

**Amended 2026-09-25 (D-053, cycle 4; supervisor's call, approved by the owner 2026-09-25).**

- **The ceiling lines are a MEASUREMENT of the organization's major league at each import** (`stakesLines.ts`, `stakes-lines-1`).
  They are no longer held as constants. The measurement is the nearest-rank tenth, median and best tenth of its active major
  leaguers' visible composite, by kind.
  - It is served as measured once a tie-aware club split holds steadily.
  - A league under 10 clubs or 100 major leaguers of a kind keeps "Pennant's starting line", said so.
  - A measurement that does not hold up keeps the lines in force.
- **The anchor is still absolute for the player.** The lines read his league's major leaguers at the import (never the players
  around him, never his results, usage, philosophy, Player Value or MLB Operations). So a man's tier can move at an import only
  because the league's major leaguers moved, for everyone alike, and his reasons then say so.
- **Wording.** The starting lines are never called "this league's".
- **How the evaluator gets them.** It is handed the lines by the one context reader (required, never defaulted).
- **On the Arizona import** the lines equal the starting lines, and no tier moves.

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

**Status:** Accepted 2026-09-22, with the owner's answers in PLAYER_VALUE.md Part 12. **Implementation:** Partial
(phases 1–3: contract facts and control; Club Finances, the opening price of a win, the replacement level and the
per-import market snapshot; expected production in wins from major-league results and, through `scoutedEvidence.ts`,
scouted ratings, with playing time conditional on quality, fitted per save under D-053; phase 4a: the cost of
controlled seasons, measured on each import, `playerValueCost.ts`; phase 4b: the measured price of a win across imports,
`playerValueSignings.ts` and the third writer `playerValueContractStore.ts`; phase 5a: the neutral contract surplus and the
retention margin, `playerValueSurplus.ts`, on the player card; phase 5b: the philosophy lens, `playerValueLens.ts`, and the
club's value of a win, `playerValueWinValue.ts`; phase 6b, the first consumer of the migration built here: the Trade Center,
the trading block and the AI's trade context read Player Value, `playerValueTrade.ts`, and no `players_value`; phase 6c:
Free Agents, the club's thinnest positions (`positionNeeds.ts`) and the AI's value context read Player Value, a free agent's
figure is his production at the market (`marketValueOf`), and Payroll, Free Agents and the Trade Center say how current the
export is; phase 6d: Org Comparison on Player Value, the Roster's scouting column and the Lineup on `scoutedEvidence.ts`;
phase 6e: the last `players_value` readers deleted from `valuation.ts` and the boundary's allow-list empty, Payroll in plain
words, the trading block on the export's freshness, Free Agents' "Might reach the market").
`server/playerValue.ts` (the entry point), `playerValueContract.ts`, `playerValueControl.ts`,
`playerValueFinances.ts`, `playerValueHistory.ts`, `playerValueProduction.ts`, `playerValueProductionFit.ts`,
`playerValueRatings.ts` and `playerValueRatingsFit.ts` (phase 3b), the two writers (`playerValueSnapshot.ts` and
`playerValueFitStore.ts`, `history.db` only), `playerValueRoutes.ts` and `playerValueCalibration.ts`;
contract-control eligibility in `playerRights.ts` (`evaluateContractControl`); one `LeagueRules` in `leagueRules.ts`,
with the financial regime; `tests/playerValueBoundary.test.ts`. The `players_value` consumer migration (phase 6) is
built: no module reads `players_value` (6a to 6e). In phase 3b the
development path, the ratings' reliability as a forecast and the arrival chance by potential wait on the save's own
rating snapshots (one on the imported save) and use the provisional prior, or the kind's K, until then. Design: [PLAYER_VALUE.md](PLAYER_VALUE.md). Research evidence:
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
- **Expected production is the expected wins** (amended 2026-09-23, the hardening): the rate of the players who play at a
  horizon is fitted apart from the chance he plays, since the players who keep playing are the ones who stayed good;
  playing time is read per scheduled game and never exceeds the physical ceiling the save's own history shows. Known
  days out are a fact that moves the central (owner, 2026-09-23), and a season lost to injury is never read as evidence
  of less future playing time.
- **A decomposed, stated estimate, never a hidden score.** Value is reported as bands with their basis and every
  component visible. Thinner evidence (fewer results, partial ratings) only widens a band; a longer horizon only widens
  what is not known about a player's rate, while his band in wins follows his expected playing time (owner,
  2026-09-23). No
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

**Stamps.** Every constant is registered in PLAYER_VALUE.md Part 11. The opening replacement level and the opening
price band are **provisional**; the arbitration ladder was, until phase 4a measured it per import (below). What counts as a market contract, the discount rate, the
horizon, the evidence needed to replace the opening price, the personality bands and the lens weights are
**policy**. Production is fitted on each save's own history and stored per save (D-053): its policy is in code, its
fitted numbers are the save's, and only the fallback prior is in code (provisional). Bands only
widen, the lens comes after the neutral value, sunk money cancels and unknown is never a default: that is
architecture, pinned by tests.

**Owner answers** (PLAYER_VALUE.md Part 12):
- Arbitration and free-agency eligibility live in Player Rights; the cost for each status lives in Player Value.
- No widening for other organizations' players until it can be measured.
- The horizon runs to the end of control, capped at 7 seasons, with one stated policy discount rate.
- The measured price replaces the opening one when its band is narrower (phase 4b: narrower than the opening band with
  its sampling, in dollars).
- A minor-league $0 salary is `unknown`.
- The club's value of a win is in playoff odds for now.
- Personality prices nothing until its effect is observed.
- The Trade Center may show the difference between the sides only as a band with its components.
- Minor-league WAR is not used in phase 3.
- Player Value is routed in `AGENTS.md` from phase 1.
- Super Two (2026-09-22): OOTP applies Super Two under MLB rules, and Pennant follows the real rule. This is the
  owner's statement of how OOTP behaves, a basis under D-018 and D-023 (`owner_attested`), not a guess from MLB
  rules. The cutoff is computed from the export's own class as a range, in leagues whose regime as read is MLB's.
- Super Two margin (2026-09-23, hardening): the cutoff's edges are readings, not bounds, so within a policy margin
  of either edge (`SUPER_TWO_MARGIN_DAYS`, 10 days, stamped policy under D-041, owner-approved) the year before the
  arbitration line is `indeterminate`.
- Phase 4 (2026-09-24): the price in force is per win produced; Payroll combines players as independent; an arbitration
  salary never falls (owner-attested); contract snapshots are kept at the winters (the amendment of that date, below).

**Hardening, contracts and control (2026-09-23).** An option is both branches only for a future season: the season
under way is under contract, its option decided before it began. An **opt-out** makes every season from the one the
exported count reads (the term's first season plus the count, a reading and not established, R-6) show both
branches, staying under the deal or leaving on his Player Rights standing; it is never a certain season at a point
cost. A club and a player option on one season is mutual; an option flag the export does not populate is unknown on
the term's last season. The export's blank contract row (no term, kind, salary or paying club) is not a
minor-league contract: it has no kind, and a player the export places on a major-league club with major-league
service reads his Player Rights standing after this season. Consumers see an option next season as an option,
never "signed", and Payroll reads these contract facts through the entry point. Player Rights counts arbitration
trips by winter, caps this season's remaining service by the schedule, projects later seasons from the schedule's
calendar, and gives a player on the major-league injured list the days left on his stint (the list accrues
service), all in PLAYER_VALUE.md 2.1 and 2.2.

**Amended 2026-09-23 (phase 4a: the cost of controlled seasons; PLAYER_VALUE.md 2.2 and 4.4, CALIBRATION.md section 8).**
A pre-arbitration renewal and an arbitration season are priced from the save's own contracts, **measured on each import**
and snapshotted with the market, never assumed: the renewal from the league minimum to the save's renewal spread; an
arbitration season from the save's arbitration ladder by class (a base and a pay per win of the two-season platform,
with the class's spread and the line's error) at the platform seasons' production, edge against edge. The save's own
line is in the import's dollars (read at the price's central); only the provisional prior's shares carry the price of a
win's band. It is a measurement, not a D-053 fit: one import has no held-out outcome to gate on,
and phase 4b tests it against observed awards. R-6's imported-contract ladder is only the provisional prior, used below
the policy minimum and only where the regime as read is MLB's; a league without arbitration, or whose rule is not read,
never gets it. Status, class and trip are Player Rights' (`arbitrationRegimeOf`, `tripIfEligible`). A projected cost is
never committed money: consumers show it beside guaranteed commitments, never in their totals.

**Amended 2026-09-23 (phase 4a review; PLAYER_VALUE.md 4.4 and Part 9, CALIBRATION.md section 8).** A class's line is
read robustly (Theil–Sen), its uncertainty from a bootstrap of the same fit, so one star or one free-agent-market
contract read in the class cannot move a rung. Below the policy minimum a class has **no line of its own**: it is the
provisional prior's reading hulled with the range the save paid the class, so the save's own contracts only widen it and
a handful of them never set a slope; where no prior applies it stays unknown. Every priced band carries a **central**
inside it (the line at the platform's central); a season between statuses Player Rights leaves open names each status's
central and chooses none. A band is a range of reasonable readings, edge against edge, and every surface says so;
Payroll sums the players' edges (their statistical combination was an owner question) with the sum of centrals beside
them (combined as independent since the owner's decision of 2026-09-24, below). A contract at the league minimum is kept out of the line and is never named a transaction; a season whose
platform reaches as low as such deals in its class reaches the minimum, said. A branch the player decides (a player or
mutual option declined, an opt-out) is priced only as what he costs if held. Player Rights states each season's
**service class** (`serviceClass`), where one import's cross-section reads a player of that service, and prices cover it
beside the trip; in a regime with no arbitration Player Rights lists no season as possibly arbitration. A reading
computed without production prices no controlled season. MLB's 20% maximum salary cut is not applied: it is not
owner-attested for OOTP (the owner attested a different rule on 2026-09-24, below: an arbitration salary never falls).

**Amended 2026-09-23 (phase 4b: the measured price of a win across imports; PLAYER_VALUE.md 4.1 to 4.4, Part 7,
CALIBRATION.md section 9).**

- **Each import records its contracts** in `history.db` (a third writer, `playerValueContractStore.ts`, keyed by the save's
  identity, league and game date, additive and idempotent, never able to fail the import): every contract the market
  league's clubs hold and every unsigned player whose production is established, with Player Rights' standing for three
  seasons, his expected production and next season's cost as the entry point served them then.
- **A change between two imports is named, then read through Player Rights at the earlier one** (D-020, D-023): a new
  deal for a player free-agency eligible for its first season, with an organization that did not hold him (or none), is a
  market signing; a one-year deal with his club in arbitration is an arbitration salary (award or settlement, not said);
  a one-year deal before arbitration a renewal, under a reserve clause a reserve-clause renewal; a longer deal while
  controlled, or one over seasons still covered, an extension; the same terms with a new club moved with him; a
  controlled player no club holds was not tendered or released, the export not saying which. Nothing is given a
  transaction type the export does not carry, and an ambiguous change is counted and left out of every measurement (a
  free agent re-signed by the club that held him is one: whether he reached the market is not exported; policy).
- **The measured price** is the ratio of summed salary above the minimum to summed expected wins at the earlier import,
  over free-agent signings whose first season had not begun then, pooled over the save's winters; its band is the
  signings resampled (80%). It needs the opening basis's minimum (20 contracts). **Adoption (Q-4):** it replaces the
  opening price only when its band is narrower than the opening band **with its sampling** (B-13's deferred component:
  each opening basis resampled over its own contracts the same way), compared in dollars; otherwise the opening price
  stays in force and says why, naming the signings and both bands. The price's history (each import's opening and
  measured readings, which was in force) is recorded and served.
- **Observed arbitration salaries** are scored against the band the earlier import priced (reported, not gated) and, at
  the ladder's minimum per class (30, pooled over winters), become a reading of the class beside the import's
  cross-section, the band covering both. **Reserve-clause renewals** observed across imports price a reserve-clause season
  by the renewal spread's method at 30. **Replacement** is measured from freely acquired players (a minor-league deal, or
  a major-league deal at the minimum, from outside the organization, with a major-league record) by their WAR per 600
  opportunities for the club that took them, at 30 players; until then the export's convention stays, provisional. Once
  measured, the measured price counts wins above it; production stays in the export's WAR, and surplus (phase 5) must
  apply the same level to both. All of it is measurement across the save's own imports, stamped policy for its rules
  (`SIGNINGS_POLICY`); no number is fitted in code.

**Amended 2026-09-24 (phase 4b review: R3 correctness, R4 method; PLAYER_VALUE.md 4.2 to 4.4 and Part 9, CALIBRATION.md
section 9).**

- **The measured price never changes what it measures.** It is read like the opening price, as a set of bases each with
  its sampling: per win projected at signing (over the deal, and in the first season), per win expected in the first
  season if he plays, and per win produced in the first season once that season is completed (the opening's own unit).
  It is compared with the opening band with its sampling only once it holds that realized reading, and only when its
  signings cover each third of the winter's free-agent class (5 each); both are tightenings of Q-4, whose wording is
  unchanged. Its central is the realized reading's. The reason names the unit and flags a central below the opening
  floor or outside its band. An opening band whose sampling has no upper edge is wider than any bounded band. Which unit
  the price in force uses once measured is the owner's question; until then the comparison is like for like.
- **Replacement from free talent is shown, never applied**, until surplus applies one level to both sides (phase 5); it
  is measured on each pickup's season with the club that took him and says how many did not play.
- **A winter is read by the calendar, and a timeline is never crossed.** An import before its season began is inside
  that winter (never "a season already under way"); several imports across one winter are one winter; a pair a winter
  or more apart is counted and not measured. Imports are paired in the order recorded: a save that went back, or a date
  imported again with different play, starts a new timeline, and the abandoned one's observations of the same period
  are left out.
- **What changed is named for what the export shows:** an extension that moves with a traded player is not a signing; a
  free agent signed by an organization his lines show held him during the season before is left out like a re-signing;
  a term that ends no later than it did is a term changed within its seasons; rows with no term are never "the same
  terms".
- **One earlier import is read per import.** The pair a new import forms with the one before it is stored with the
  reading's method; the market reads the stored pairs. The history is not pruned: retention is the owner's question
  (decided 2026-09-24, below).

**Amended 2026-09-24 (phase 4 owner decisions, owner-approved; PLAYER_VALUE.md 2.2, Part 3, 4.2, 4.4, Part 7, Part 11,
Part 12; CALIBRATION.md sections 8 and 9).** The owner ruled on the four questions the phase 4a and 4b reviews left open.

- **The price in force, once measured, is per win produced.** The measured price is the realized reading (first-season
  salary above the minimum over the WAR the signings produced in that season, the opening's own unit): its central and
  its band are that basis's own. The readings per win projected at signing are shown beside it as a check on the
  projection, with their ratio to the price, and are never the price in force, never in its band and never its central.
  Until the realized reading exists nothing is measured in the price's unit. The adoption reason, Payroll's price line
  and the price's history follow it (`SIGNINGS_POLICY.priceUnit`, policy).
- **Payroll combines players as independent.** A club's projected cost is the sum of centrals with each player's
  distance from his central, low and high sides apart, combined across players as the root of the sum of squares; what
  is not random noise stays at its edges and is added: which status a season Player Rights leaves open is, which class a
  range of arbitration classes is, and whether a player who may leave is held. Stated as policy under D-041
  (`COST_COMBINATION_POLICY`), labelled "players combined as independent; not a calibrated interval", the edge-to-edge
  sum kept in the details; no player's own band is narrowed, and the interval arithmetic of Part 3 stays for everything
  else. This is the one place Player Value reads players as independent; phase 5 may calibrate it.
- **An arbitration salary is never below the player's previous season's salary** (owner-attested, "I've never seen a
  drop"). A rule of the game as the owner attests it, basis `owner_attested` like Super Two (D-018, D-023), stated once
  by Player Rights (`ARBITRATION_NO_CUT_ATTESTATION`, `arbitrationSalaryFloor`, stamped policy) for every league whose
  regime as read has arbitration, and consumed by the cost ladder; never an MLB assumption, and not the CBA's cap on a
  cut. Every season priced as arbitration, the arbitration branch of a season between statuses included, has its low
  edge and central at least the previous season's salary where it is known (the contract's salary for next season; the
  season before's low edge after that, so a held player's arbitration low edges never fall); where it is not known the
  rule cannot bind and says so. It is what he costs if tendered: a non-tender stays possible, and is said. Phase 4b
  tests it: an observed arbitration salary below the player's previous salary is flagged as contradicting the rule,
  counted and named, never silently absorbed.
- **Contract snapshots are kept at the winters.** Full contract snapshots are kept only for the imports that bracket a
  winter (the last before it, any inside it, the first after it) and for the most recent import; every stored pair and
  timeline event is kept as the durable record. The contract store prunes at capture time, after the new pair is
  stored, in one transaction that records the pruning as an event; never across save identities, never the latest,
  never a snapshot a pair not yet stored under the current method needs. It is the only deletion Player Value makes,
  `history.db` only, and the boundary test holds it to that one statement. The consequence: a later change of the
  reading's method can re-derive a pair only from the snapshots kept; an in-season pair is read as stored, under its
  own method (`SIGNINGS_POLICY.retention`, policy; method `signings-4b.3`).

**Amended 2026-09-24 (phase 5a: the neutral surplus and the retention margin, owner's discount decision; PLAYER_VALUE.md
2.5, Part 5 (5.1), Part 7, Part 8, Part 9, Part 11, Part 12).** Concern 5 is built for the neutral view
(`playerValueSurplus.ts`, pure; served on every valuation that computes production and cost, and by
`/api/player-value/:playerId/surplus`).

- **The discount rate is 5% a season** (owner, 2026-09-24): a time preference, one stated rate, a season *s* seasons from
  now weighing 1/1.05^*s* and this season's remaining part 1. The price of a win is held flat (no salary inflation is
  assumed) unless the save's own measured price history later shows drift. Policy under D-041 (`SURPLUS_POLICY`,
  stamped `SURPLUS_POLICY_CALIBRATION`).
- **One level of replacement on both sides.** Production is the export's WAR (wins above its replacement level), the
  replacement's wins are 0 there, and the price is salary above the minimum per win above that level, so production value
  is the minimum plus wins × the price. The measured replacement from freely available talent stays shown, never applied.
- **Contract surplus** per controlled season within the horizon is production value less cost, edge against edge,
  discounted and summed; the rest of this season counts only its part still to be played (the same share of salary and of
  the minimum), and what he has banked and the salary paid are sunk: shown, never counted. An option season is the hull
  of its two ways and chooses no central; a season he may leave in is "if held".
- **The retention margin** is (his wins − the replacement's 0) × price + the minimum a replacement would cost − the costs
  that exist only if he is kept (a projected renewal, arbitration or reserve-clause salary; an option's salary less a
  buyout the export does not populate, read from nothing to the salary). A major-league contract's covered salary is owed
  whatever the club does and cancels. A 40-man spot is stated, never priced. **Sunk salary never favours keeping a
  player**: on the Arizona save, doubling every guaranteed salary of each of the 1,054 players with one never changes his
  retention margin.
- **Unknown stays unknown**: a season with no established wins or cost has no surplus, and a sum over it names the seasons
  it cannot include; without dollars the value is in wins only. Neither view is a verdict. No consumer beyond the card is
  migrated (phase 6).

**Amended 2026-09-24 (phase 5b: the philosophy lens and the club's value of a win; PLAYER_VALUE.md 4.5, 6.1, Part 7, Part 8,
Part 9, Part 11, Part 12).**

- **The lens is the one value module that names philosophy** (`playerValueLens.ts`, pure, `ourViewOf`). It is handed the
  neutral valuation every read serves and the organization's philosophy at read time (the route reads it from settings for
  the viewing organization: the one the page names, else the configured default, else the club the save is played as), and
  returns "our view" beside the neutral one. It never changes a neutral figure, band, price, cost, control status or
  unknown; a philosophy with every dimension inside 40–60 and the default policies leans on nothing, and our view is then
  the neutral view exactly. Every lean names its dimension, value, what it did and by how much (sequential steps that add up
  to the difference), and a dimension read but not leaning says why. It reads `competitiveWindow` (our discount, 0% to 15%
  against the neutral 5%; this season's part weighs 1), `riskTolerance` (the reading from each range's centre toward its low
  edge, up to half way; never above the centre), `teamControl` (the seasons the club controls at its option, ±20%),
  `costEfficiency` (his cost against his production, ±20%) and `payrollFlexibility` (guaranteed salary in later seasons,
  ±20%, in the contract view only: in the retention margin that money is owed either way and no philosophy brings it back);
  the four policies only word emphasis. Policy under D-041 (`LENS_POLICY`, stamped `LENS_POLICY_CALIBRATION`). It reads no
  production, cost, fit, table, rating, protection tier, defensibility or club value of a win (boundary test).
- **The club's value of a win** (`playerValueWinValue.ts`, pure; `clubWinValue` in the entry point) is read on the deadline
  read's odds model (`posture.ts` now exports it: `oddsModelOf`, `oddsAt`, `shownOdds`): how much one more win (a loss
  turned into a win) moves this club's chance of the postseason now, and the curve from three wins fewer to five more over
  the rest of the season, in points of playoff odds, never dollars (Q-6), stamped provisional (`WIN_CURVE_CALIBRATION`). A
  club fact: the same for every organization, never read by the lens, never in the neutral value. Where the odds cannot be
  read (no game played, no standings, the club not in its conference's standings) it is unknown with the reason, never the
  deadline read's default; with no games left it is not applicable; where the place is beyond reach a win moves nothing.
  Served on Club Finances (Payroll) and with our view on the player card.
- **The odds model's cushion is the nearest rival's.** `playoffPicture` measured a division leader's cushion against the
  last club in its division; it now measures it against the nearest (Arizona: 7 games and 86% before, 0 games after; 57% read against the division alone, 75% with the leader's wild-card route the owner approved the same day),
  which the deadline read, the dashboard and MLB Operations' season read see too.
- **The card says it plainly** (owner, 2026-09-24): "Contract value" and "Value of keeping him" (the API keeps "contract
  surplus" and "retention margin"), "Most likely" and "could be", "if kept", the explanations on hover.

**Amended 2026-09-24 (phase 6a: the player card's header and Contracts migrated; PLAYER_VALUE.md Part 8, Part 9, Part 12).**

- **Replace, don't run in parallel, applied.** The card's header and Contracts read Player Value only, and their
  `players_value` reads were deleted in the same change: the Value and Talent percentiles, OOTP's Overall / Potential on
  the card and its hover, `valuesByPlayer`, `mlbPercentiler` and `contractsByPlayer` in `player.ts` and `contracts.ts`,
  and the card's direct `players_contract` query. The one scouting figure the header shows is the organization's scouted
  tools through `scoutedEvidence.ts` (D-017), labelled as the scouts' view, never OOTP's.
- **Contracts describes; the GM decides.** Its percentile advice (`recommendOnValue`, the 70/75 cut-offs, the season's
  "Hold off" veto) is deleted with no replacement verdict: the page shows contract facts, when control ends, the cost
  path, expected wins, the contract value, the value of keeping him and our view, each with its basis on hover, grouped
  and sortable. The dashboard counts players heading to arbitration instead of "extension candidates"; the assistants are
  told the rows carry no recommendation.
- **Freshness reaches the GM (A-20).** A page or route that shows value passes the export's freshness to Player Value
  as `currentState` and states the export's game date, and says when it is behind the save or could not be checked
  (`freshnessCue`); so far Contracts, the card and the one-player value routes. The other consumers carry it with their
  own migration.

**Amended 2026-09-24 (phase 6c: Free Agents and the AI's value context migrated; freshness on Payroll, Free Agents and the
Trade Center; PLAYER_VALUE.md Part 8, Part 9).**

- **A player no club holds is valued as his production at the market.** He has no contract and no control, so no
  contract value and no value of keeping him (the surplus is `not_held`). What Player Value serves for him is one season's
  production value, the same figure the contract surplus is built on (Part 5): the league minimum (what a replacement at
  0 WAR costs, the price's own zero) plus his expected wins that season × the price of a win in force, held flat, edge
  against edge, its central from the components' centrals, undiscounted (one season). Free Agents shows it for next season
  (`marketValueOf`, in `playerValueSurplus.ts`, served through the entry point with the league's market,
  `surplusMarketOf`). It is not an asking price, an offer or his worth to any one club, and no consumer computes it:
  a consumer multiplying wins by a price is a boundary failure (`playerValueBoundary.test.ts`). Unknown production, or a
  league with no price or minimum, leaves it unknown with the reason, never $0; a low edge below the minimum is shown, never
  clamped (his production may be below a replacement's).
- **No hidden cut, no hidden score.** Free Agents lists every player the control timeline finds reaching free agency after
  this season (the old `overallPct >= 40` cut and the value percentiles are deleted), ordered by expected wins next season,
  a shown figure, unknown last. The club's thinnest positions (`positionNeeds.ts`, replacing `valuation.ts`'s
  `rosterHoles`, which ranked by OOTP's overall value) are read by each position's best player's expected wins this
  season, each figure shown, a position with nobody valued named apart; one reading for Free Agents, the draft board and
  the trade desk.
- **The AI explains the same figures.** The note that explained OOTP's value percentiles to the prompts is deleted (no
  context carries one); the briefing and the staff chat are told what Pennant's value figures are, to quote them as ranges,
  to produce no value number of their own and that they recommend nothing (D-001).
- **Freshness reaches the GM on Payroll, Free Agents and the Trade Center** (A-20), as on Contracts: each hands the export's
  freshness to Player Value as `currentState` and shows the game date with the warning where the export is behind the save
  or could not be checked. The assistants' contexts carry the date and the warning too.

**Amended 2026-09-24 (phase 6d: Org Comparison, the Roster's scouting column and the Lineup; PLAYER_VALUE.md Part 8, Part 9).**

- **A comparison of clubs ranks nothing.** Org Comparison shows each organization's Player Value figures as each player
  is served (the major-league roster's expected wins for the rest of the season and its contract value, the farm's
  expected wins next season) and objective facts (record, OOTP's payroll and budget); each sum combines its players as
  independent the way Payroll does and names the players it leaves out. No rank is sent; the page orders clubs only by a
  column it shows, unknown last. OOTP's overall and talent values and the ranks built on them are deleted.
- **Not every rating read is a value question** (Part 8, row 6). The Roster's scouting column shows the organization's
  scouted tools (the card header's "Scouted" figure) and the Lineup reads its bats and gloves through `scoutedEvidence.ts`,
  under their owners, not through Player Value; OOTP's Overall, Potential and offensive value are read by neither. The
  lineup's bat is the tools model on the split grades (D-035) in a unit chosen so the solver's glove weight keeps its
  balance; the solver is unchanged.

**Amended 2026-09-24 (phase 6e: the migration's cleanup, Payroll in plain words, and the owner's answers on phases 6a to 6d;
PLAYER_VALUE.md Part 8, Part 9, Part 12).**

- **The migration is finished.** `valuation.ts`'s last `players_value` readers (`valuesByPlayer`, `mlbPercentiler` and its
  percentile type), the unused `contractsByPlayer` and their caches (`clearValuationCaches`) are deleted. No server, client,
  script or desktop module reads `players_value` or names one of its figures, and `tests/evidenceBoundary.test.ts` holds no
  allow-list: a module that starts reading it fails, never joins a list (D-017).
- **Payroll speaks plainly** (AGENTS.md "Writing for the GM"). What a controlled season could cost reads "most likely $X ·
  could be $A to $B", a season he may leave "if kept"; the price of a win "A win costs about $X here · could be $A to $B";
  what a controlled season costs is said as a renewal's range and the contracts each arbitration year is read from. The owner's
  label "players combined as independent; not a calibrated interval", the method (sum of most likely costs, each player's
  distance combined as independent, what is not chance at its ends), the every-player-at-his-edge sum, whether a cost is
  measured or rests on the provisional prior, and the floor under the price move into the hovers and breakdowns, never
  dropped. Every figure is still on the page. The card's production cone says its bands and its calibration line plainly the
  same way ("80% range (not yet checked on this save)", "Not yet checked against this save's own seasons"), the calibration
  statement itself on hover.
- **The trading block reads on the export's freshness** (A-20), like the Trade Center: `tradingBlock` hands it to Player
  Value as `currentState` and returns it with Player Rights' limitations.
- **The owner's answers (2026-09-24), all approved as recommended.** 6a: the card header's "Some terms not in the export"
  stays, muted; the dashboard counts "Heading to arbitration"; the header shows contract value only. 6b: a trade combines
  players as independent (`TRADE_COMBINATION_POLICY` confirmed); the AI desk gives no accept-or-reject line; trade fits order
  by most likely wins. 6c: a free agent gets one season at the market (no multi-season reading for now); Free Agents lists the
  players who might reach the market as a third list; the briefing's "Recommendation of the Week" becomes "Worth a look this
  week", worded as something to look at, never an instruction (D-001). 6d: a bat with no split grades is read on his overall
  grades, labelled; Org Comparison keeps its contract-value column as a range; the farm column keeps established players sent
  down ("nearest help").
- **Might reach the market.** Free Agents' third list is every major leaguer elsewhere whom the control timeline leaves
  between staying and free agency after this season (`controlAfterThisSeason`): an option or opt-out whose declined branch is,
  or may be, free agency, and a next season not settled that may be free agency (or names nothing it lies between). Each shows
  a short word for why ("Club option", "Can opt out", "Close to free agency", "Not settled") with the timeline's reason on
  hover, the same columns and order as the other lists, unknown last, never mixed into the free agents after this season and
  never a verdict. A player the club controls whichever way an open question goes (between pre-arbitration and arbitration, an
  option declined into arbitration) is not listed.

**Amended 2026-09-25 (owner decision for the SwiftUI rebuild; D-057, SWIFTUI_REBUILD.md section 3.4).** A comparison at one
position may name a **league place**. The owner: "OOTP itself shows rankings for club positions." This narrows phase 6d's
"a comparison of clubs ranks nothing" and does not repeal it:

- The place is a count of clubs, never a score: "7th of 30 at shortstop", from each club's holder at the position valued
  the way Player Value already serves him, the same figure for every club and under the same fog of war (our scouts' view
  of their players).
- It is stated with **how many clubs' ranges overlap** it and its basis. Two holders whose ranges overlap are not said to
  differ, and a place with a wide overlap says so on screen.
- A club whose holder is **not valued** is never ranked, never placed last, and is named as left out; "of N" counts only
  the clubs placed.
- The whole-organization comparison (Org Comparison) still sends no rank and sums nothing into a composite. Nothing is
  combined across positions into a club score.

Not built: the first consumer is the Club Profile's roster map (milestone N6).

## D-053 — Calibration belongs to the save

**Status:** Accepted 2026-09-22 (owner decision). **Implementation:** Partial. Player Value's expected production
(phases 3a and 3b) implements it first: `server/playerValueProductionFit.ts` (the method and its backtest; since phase
3b playing time conditional on quality), `server/playerValueRatingsFit.ts` (phase 3b: the ratings mapping, the arrival
rates and, from the save's own rating snapshots once enough exist, the development path),
`server/playerValueFitStore.ts` (table `value_production_fits` in `history.db`, both models), `PRODUCTION_POLICY`,
`RATINGS_POLICY` and the provisional `PRODUCTION_PRIOR` and `RATINGS_PRIOR` in `server/playerValueCalibration.ts`, the
refit after an import (`api.ts` `refitAfterImport`), `GET /api/player-value/production-fit/:orgId`, and `npm run
calibrate production` for a developer's forced refit. Amends D-037 and D-041. MLB Operations' roster review follows since cycle 1
(2026-09-24, amendment below; cycle 2 the results lens, cycle 3 platoon and the long-man line): role standards, aging curve and glove weights, on the neutral `saveIdentity.ts`,
`saveCalibrationStore.ts` and `saveCalibration.ts`; since cycle 2 (2026-09-25, amendment below) the results lens's season weights
and stabilization (`mlbResultsFit.ts`), judged by the neutral detector (`calibrationDetector.ts`), and the league's own wOBA scale. Since cycle 3 the platoon weight around the league norm and the long-man line; since cycle 4 (2026-09-25) the tools lens on forward
cases (`mlbToolsFit.ts`, through the neutral `ratingsForward.ts`) and Player Development's ceiling lines (`stakesLines.ts`).
The other subsystems' calibrated constants are not migrated yet (ROADMAP "Later: calibration and longitudinal management").

Pennant has to work across very different saves, including fictional leagues whose ecosystems look nothing like
modern major-league baseball. A number fitted on one save's history and written into the code is that save's
answer, not a method: on another save it is a guess presented as a measurement.

- **Code holds the method and the policy.** The method is the fitting procedure and its backtest. The policy is
  what the method is asked to achieve and when it may be trusted: coverage targets (80% and 50% central
  intervals), minimum samples, the era and hold-out rule, and the adoption tolerance. Fitted numbers (aging
  curves, regression amounts, band widening per horizon, effects of injury proneness) are not written into code
  as the answer.
- **The fit is the save's.** It is computed from the save's own export history and stored per save in
  `history.db` (additive and idempotent, like `value_market_snapshots`). Each fit carries a run record, which is its
  stamp: the seasons and sample it was fitted on, the game date of the import, the held-out coverage per horizon for
  both bands, the prior's weight, the gate's verdict and the method version.
- **It refits itself.** After an import whose export holds a completed season newer than the last fit's (a season
  is complete when every club has played its schedule, read from the league's own standings; no wall clock and no
  timer), the fit is redone in the background, once. The refit can never block or fail the import. A re-import
  without a newer completed season fits nothing.
- **A gate decides adoption.** A new fit is adopted only if its held-out coverage is within the stated tolerance of
  the targets at every horizon with enough held-out cases. Otherwise the previous fit stays in force, and the reason is recorded and
  shown.
- **Thin or no history uses a prior, and says so.** Below the minimum sample, each component is shrunk toward a
  generic fallback prior with a weight set by the sample, and the bands are served wider by that weight. This is
  labelled "not yet calibrated on this save (N seasons)". The fallback prior is the only fitted artefact code may
  carry: it is stamped `provisional` with its source, and it is never presented as the save's own calibration.
- **Visible.** The fit in force (its window, held-out coverage, when it was refitted and the prior's weight) is
  served through the API, and every season of a projection carries its coverage target beside the coverage observed
  at that horizon (or "not measured" under the prior), so the interface can show a one-line calibration status. A developer can force a refit
  from the harness, but the user never needs to.

"Calibrated" (D-037, D-041) now means fitted on the save's own outcomes, automatically, with the run record as the
stamp. A code-declared calibrated constant becomes a per-save fitted value plus a provisional fallback prior.
`provisional` and `policy` keep their meaning. This applies to all new work across the application; Player Value
applies it first.

**Injury proneness is a known fact** (owner, 2026-09-22). `players.prone_overall`, `prone_leg`, `prone_back` and
`prone_arm` are shown in game, like personality, so they are read as exported facts with the basis `owner_attested`,
through one reader (`server/injuryProneness.ts`), schema-tolerant. A missing column, a blank or a 0 (the export's
unfilled value on the imported save) is unknown, never "normal". Its effect is measured, never asserted: the fit
estimates, on the save's own history, how each proneness band's playing time differs from what its usage predicts,
and how its aging departs from the curve. An effect is used only when it is at least two standard errors from none.
Proneness never narrows a band: a measured effect moves the central and keeps the band's width, and an unknown
proneness widens the band by the largest effect any band showed. On the Arizona import the fit measured a
playing-time effect (hitters in the most injury-prone third play 94.1% ± 1.3 of their expected usage; 94.8% ± 1.2 under
the phase 3b playing-time model) and no aging effect that the data can distinguish.

Consequences: every Player Value production answer carries the fit in force as its stamp (`basis.model`,
`basis.calibration`). A historical save's first fits describe real-world stability and aging (the imported history),
and move toward OOTP's engine as the save's own simulated seasons enter the window. Not migrated in this change:
`resultsMetrics.ts` (season weights, stabilization, tools information), `roleReview.ts` (`AGING_CURVE`,
`DEFENSE_WEIGHT`), `toolsModel.ts`, `platoon.ts`, `bullpenRoles.ts` (leverage cut-offs), `roleStandards.ts` (role
standards), `farmCalibration.ts` (Minor League Operations) and `developmentFit.ts` (development and developmental
stakes). ROADMAP lists them for an audit and migration.

**Amended 2026-09-23 (Player Value hardening; PLAYER_VALUE.md 2.3 and Part 7, CALIBRATION.md section 6.3).**

- **What is measured is what is served.** The held-out seasons are projected in blocks, each by the method refit
  through the block's first origin, and the model a GM is served is the same method refit through the last completed
  season. The record's held-out figures are the method's out-of-time performance at each horizon, which is what the
  served model faces; no widening is chosen on the held-out cases. A projection carries observed coverage only for the
  estimator that produced it (results only), at its own horizon; the rest of a season under way and a blend with
  same-time ratings are "not measured".
- **The gate reads subgroups and bias.** Adoption needs held-out coverage as fitted within the policy's tolerance pooled
  and in every subgroup the method serves differently (kind, usage third, quality tier, age band) with enough cases, and
  a central that is not materially and significantly biased in any of them. A fit that fails keeps the previous model
  in force, however good its pooled figures.
- **Each horizon's prior weight is its own,** and so is its widening and its label ("horizons 4–7 mostly the fallback
  prior"). A prior fitted on the save's own held-out seasons (the same history, matched by season totals) is not used.
  An adopted fit that is still mostly the prior is stamped provisional.
- **The fit is the save's by identity, not name:** keyed by the save's configured name and a fingerprint of the league's
  own history, never through a season the league has not completed; a refit that fails the gate never replaces the fit
  in force; the refit runs off the server's event loop.
- **Under the prior, the league's own WAR scale:** the kind's mean and the rate spreads come from the league's own recent
  seasons (a plain measurement, stamped derived); the prior's shape stays. The WAR scale is a unit: every term in WAR
  per 600 is put in the league's unit and every coefficient on a rate by its inverse, so the same record in a league at
  0.4 of the scale projects 0.4 of the rate on the same playing time.

**Amended 2026-09-23 (owner decisions: option C and four approvals; PLAYER_VALUE.md Part 12, CALIBRATION.md section
6.3).**

- **The backtest is rolling-origin.** Each completed season from the window's start + 5 to the season before the last
  (at most 8) is an origin scored by the method fitted through it; a horizon is scored only where that fit has enough
  cases from at least 3 origin cohorts; the pooled cases are clustered by player and by origin, so one era cannot
  decide the verdict. Seasons are weighted by a recency half-life (policy, 2 seasons). The gate's tolerances are
  unchanged: pooled coverage within 5 points, every subgroup within 10, a bias failing at 10% of the mean outcome and
  0.05 wins and three standard errors, 200 cases. A fit that fails is not adopted however close it is.
- **The serving rule** (approved): the model served is the method refit through the last completed season, and the
  held-out seasons are scored by refits of the method.
- **A career-ending injury** (approved): the central goes to zero, the high edge is kept.
- **The rest of this season** (approved): measured from this season's own games so far.
- **Same-time ratings pull less** (approved): until the save measures them as a forecast, they pull only by their own
  weight.
- **A fit is calibrated only where it was measured:** a fit never scored on held-out seasons, or mostly the prior at
  every horizon, is labelled "not yet calibrated" and stamped provisional wherever it is served; where no season is
  usable, the label names the seasons of lines the league has and why none is.
- **Injury proneness on the Arizona import** (a correction of the reading above): with each player's seasons clustered
  and Holm's rule across the family, no playing-time or aging effect is distinguishable from none (hitters in the most
  injury-prone third 97.9% ± 1.7), so proneness moves nothing on this save; the 94.1% and 94.8% readings treated a
  player's seasons as independent.

**Amended 2026-09-23 (hardening F4: prospects; PLAYER_VALUE.md 2.3, CALIBRATION.md section 6.4).**

- **The ratings fit's arrival gate is tightened, never loosened.** Beside its absolute tolerance (10 points), a
  held-out arrival chance, or expected playing time per case, biased beyond 10% of what happened AND beyond three
  standard errors clustered by player fails: the production gate's rule, so a fit predicting three times the observed
  rate can no longer pass on a rate of a few percent. Every fit the absolute rule failed still fails. On the Arizona
  import the ratings fit (`ratings-3h.1`) fails it at horizons 3 to 6 (the save's arrival rates rose between the
  training and the held-out seasons, and the arrival method weighs every season alike): it is not adopted, so a player
  not in the majors is `unknown` there, with the gate's reason, until a fit passes. Recorded, not tuned away.
- **The serving rule applies to the arrival model:** served refit through the last completed season, scored on the
  held-out seasons by the method fitted through the training seasons.
- **The arrival population is the league's own:** another market league's farm and independent leagues are left out
  where the export names parents, and reaching any top-level league is arriving.
- **A fitted effect may be carried from one fit to another, recorded:** the ratings fit reads the results fit's quality
  coefficients (at the same usage) and locates them on each arrival cell's players now, so the cell keeps its measured
  chance and playing time; both are stored in its record, and a refit of either refits the arrival's use of them at
  the next ratings refit.

**Amended 2026-09-23 (owner decision: option C applied to the arrival model; hardening F5; PLAYER_VALUE.md Part 12,
CALIBRATION.md section 6.4).** The owner approved: "the arrival model uses the same rolling-origin backtest and 2-season
recency weighting approved for the results fit, judged by the same (tightened) gate; the gate is not loosened."

- **The arrival backtest is rolling-origin,** by the results fit's own origin rule (shared code): each origin is fitted
  through its season and scored on the next season's minor leaguers, a horizon only where that fit holds the gate's
  minimum cases from at least 3 origin cohorts. Each arrival fit weights a case by a 2-season recency half-life
  (`RATINGS_POLICY.backtest`, policy). The gate's standard errors are clustered by player and by origin; its
  tolerances (10 points; 10% of what happened and three standard errors) are F4's, unchanged. A one-era miss is now
  read across the origins, so a fit that keeps missing in one direction fails and one era's swing does not.
- **A tightening the change needs:** measured arrivals are adopted only where the next season could be checked on
  held-out cases (a history too short for any origin used to be checked by a single split).
- **The serving rule is unchanged** (refit through the last completed season). Method `ratings-3h.2`: every save
  refits once.
- **On the Arizona import the fit still fails,** at horizons 4 to 6 (the chance 17% low, about 7 standard errors); 0 to 3
  pass. Recency cannot reach it: a long horizon can only be fitted on cohorts at least that many seasons old, and on this
  save the long-horizon arrival rate rose cohort after cohort. Recorded, not tuned away; prospects stay `unknown` there.

**Amended 2026-09-23 (owner decision: option (b), the arrival model adopted horizon by horizon; hardening F6;
PLAYER_VALUE.md 2.3 and Part 12, CALIBRATION.md section 6.4).** The owner decided: "The arrival model is adopted horizon
by horizon: a horizon whose held-out check passes the (unchanged, tightened) gate is served; later horizons are shown as
not established. The gate is not loosened."

- **What is adopted is a contiguous run.** The horizons served run from the rest of this season through the last horizon
  whose held-out check, and every check before it, passed the gate. A horizon after one that failed, or after one with too
  few held-out cases to be checked, is never served, even where its own check passes. Nothing is adopted unless the run
  reaches the next season (F5's rule), and the ratings mapping's own gate must still pass. No tolerance moved
  (`RATINGS_POLICY.adoption`, policy, D-041).
- **A season beyond the run is not established,** season by season, each with the gate's finding at its horizon; it has no
  band, central or zero, and nothing is extrapolated, carried forward or averaged into it. A total over seasons that
  include one is not a number. A label says how far the model is calibrated ("through N seasons out"), never plain
  "calibrated"; the run record names each horizon's own check and why it is not served.
- **The arrival model only.** The results fit keeps its rule that every horizon with enough cases must pass; whether it
  should follow is an open owner question.
- **Method `ratings-3h.3`:** every save refits its ratings model once. On the Arizona import the arrival model is adopted
  through 3 seasons out (the held-out figures are F5's): prospects are projected for the rest of 2026 and 2027 to 2029, and
  2030 to 2032 are not established.

**Amended 2026-09-24 (per-save calibration, cycle 1: MLB Operations' roster review; CALIBRATION.md section 12).**

- **Neutral plumbing.** The save's identity, the league's seasons and the completed-season check moved unchanged (byte-identical)
  from Player Value to `saveIdentity.ts`; every subsystem other than Player Value keeps its fits in `save_calibration_fits`
  (`saveCalibrationStore.ts`), keyed by save identity, league, subsystem, component, method and basis, and registers its refits
  with `saveCalibration.ts`, which runs them after an import in a worker thread and records them only through each component's
  gate. MLB Operations imports no Player Value file. Player Value's own table is not migrated.
- **A description of the league now may be measured at each import** (owner decision 2026-09-24). The roster review's role
  standards describe the league's current holders of each job, and their tools lens exists only now, so they are measured from
  the current export at each import (keyed by its game date; clubs must have played 15 games first), shrunk toward the built-in
  values by the holders behind each role, and adopted only if two checks pass: standards measured on half the clubs put about a
  tenth (a twentieth for the deep line) of the other half's holders under them, and the same method run on the league's own past
  seasons on the results lens puts about a tenth of the NEXT season's holders under a line set on this one. A league without
  enough past seasons to check keeps the built-in values and says so.
- **Each lens has its own line** (owner decision 2026-09-24; amends D-040). "Weak for the role on this lens" is under the role's
  median ON THAT LENS (tools, results) less the group's pooled lens gap, roughly its lowest tenth, each measured on its own scale and
  checked by the club split; the built-in lens floor serves until then. On the Arizona import the built-in lens floor had called a holder's results weak 15% to
  33% of the time, not a tenth.
- **Relievers are checked against history as one pool** (owner decision 2026-09-24): the export carries no leverage for past
  seasons, so their usage roles cannot be rebuilt; the record says so.
- **Aging** is fitted per completed season on the league's own consecutive seasons, monotone (a hitter's change never improves with
  age, a pitcher's never falls), shrunk toward the built-in curve by the pairs at each age, and adopted only if a rolling-origin
  backtest finds no age band biased beyond both a tolerance and three standard errors and the curve beats "no aging", both for the
  curve as served and for the curve fitted without the prior (on the league the prior came from, the shrunk check is not
  out-of-sample; the record says so). `concernAge`
  stays policy (when a decline is raised); a league whose curve shows no decline at an age says so, never "lost about 0".
- **The starting values are never the league's own.** While they serve, a finding says "for regular first basemen a typical working
  estimate is about 77 (Pennant's starting yardstick)" and "hitters his age usually lose about ..."; "this league's" only where the save's own
  fit is in force. The built-in aging rows are stamped provisional.
- **Checked as served.** The standards' checks score the lines shrunk exactly as they would be served. A reverted save serves its
  latest measurement at or before its game date.
- **Glove weights** are fitted from fielding RESULTS only (the repeatable spread of zone-rating runs against the bat's, on
  consecutive seasons that carry zone rating) and checked on the next season; without two such seasons and a third to check them
  the built-in weights serve, with that reason. Whether OOTP keeps a simulated season's zone rating in later exports is not known
  and is left to the data.
- **On the Arizona import** the standards and the aging curve pass and would be adopted (the standards equal the built-in values
  within half a point, being the same snapshot); the glove weights are not fitted; the lens change alone removes 6 of the
  league's 21 flags (none of Arizona's) and changes 8 more between kinds of watch.

**Amended 2026-09-25 (per-save calibration, cycle 2: the results lens and the wOBA scale; CALIBRATION.md section 13).**
The supervisor's calls in this amendment (the lifetime target, the asymmetric return, the accepted break case, the aging curve under
the rule and the app-wide wOBA scale) were approved by the owner 2026-09-25.

- **A fitted tuning value replaces its fallback only when clearly better; a measurement is served when its checks pass** (owner
  decision 2026-09-25). A tuning value with a rival value set (the results lens's season weights and stabilization, the aging
  curve) is adopted only where it beats the starting values on held-out seasons by the detector's rule (`calibrationDetector.ts`).
  - The rule (`detector-3`; independent reviews found `detector-1` overconfident and `detector-2`'s return too hard):
    - worth it at a confidence: the lower one-sided 97.5% bound of the gain is at least 1% of the starting values' error, both
      across players (clustered by player) and across seasons (Student's t on the held-out seasons);
    - consistent: better in two-thirds of the held-out seasons, and at least 3;
    - enough: 4 held-out seasons of 50 cases, so at least 10 seasons of history;
    - confirmed: clearly better at two consecutive completed-season refits before the save's values first serve (a refit that is
      not clearly better, or fails, starts the count again).
  - The rule is applied twice, unshrunk and as served, and every free parameter is chosen inside each rolling origin (nested), so
    no selection optimism reaches the verdict.
  - Otherwise the starting values serve, and the page says they were checked on this league and held up. That verdict is adopted
    as such, never shown as "not measured".
  - **Hysteresis, asymmetric** (supervisor's call: adopting is hard, giving up is easy). Once the save's values serve, a refit
    returns to the starting values when their lower bound on the gain is above zero (the same two-bound test and consistency, not
    the 1% bar). Values adopted on imported seasons therefore give way after a break in how the league plays. The record carries the
    previous state, the confirmation count and the rule applied. Methods `results-2` and `aging-3`.
  - A measurement of the league as it stands, with no rival value set (the role standards), keeps cycle 1's measure-and-check rule.
- **The target is a lifetime rate** (supervisor's call, 2026-09-25). Over a save's lifetime of yearly refits (10 to 22 seasons of
  history, with hysteresis), the rate of adopting the save's values when their true gain is under the 1% practical minimum must be
  at most 5%. This holds at the exact null and at the least-favourable nulls (a true excess of 0.5% and 0.9%), stationary and with
  season-to-season heterogeneity (noise ±25%, drift ±0.3). Power is secondary. The level, the minimum and the confirmations were
  tuned by simulation to this target.
- **Measured** (`npm run calibrate detector`, 2026-09-25, simulated leagues sized like the Arizona import; CALIBRATION.md 13.3):
  - lifetime false adoption at most 3.0% (0.0% at every exact null);
  - lifetime adoption of 92% to 100% where the starting values cost 3% to 6% more error, and 29% to 48% at about 2%;
  - pitchers' fictional-league shifts (1.3% to 2.1%): 7% to 26%;
  - no wrong return once the save's values serve;
  - after a break (the owner's save shape: noisier imported seasons, then the starting values exactly right), 5.3% ever adopt and
    2.3% still serve at 22 seasons, at a cost under the 1% minimum in the new regime.
  - With the break plus seasons differing plus a true 0.9% excess after it, 10.3% adopt. That is above the target, which covers
    leagues without a break, but what serves is on median better than the starting values in the new regime. It is recorded, not
    tuned away (CALIBRATION.md 13.3).
- **On the Arizona import** neither the season weights and stabilization nor the aging curve is clearly better. The starting values
  serve for both. The aging curve cycle 1 had served gives way (method `aging-3`), and the age explanations say "hitters his age
  usually lose about ..." again. No flag changes.
- **The wOBA scale is the league-season's own** (supervisor's call): derived from its totals in `leagueBaseline` (BaseRuns), read by
  wRC+ app-wide and by the glove-weight fit. 1.2 remains only as the labelled fallback where the totals cannot give one (an
  unrecorded total is unknown, never zero). A caught stealing's run value is derived the same way.
- **Supervisor's calls, recorded:**
  - relievers' over-trust (held-out slope 0.65) is reported in the run record and is a ROADMAP finding, not gated;
  - the tools information is deferred to cycle 4;
  - baserunning and defensive stabilization are built but inactive until the export carries UBR or zone rating for enough seasons;
  - the park share stays provisional;
  - the peer-population minimums are policy.

**Amended 2026-09-25 (per-save calibration, cycle 3: platoon and the bullpen; CALIBRATION.md section 14).** Every item is the
supervisor's call, approved by the owner 2026-09-25 (the owner was away and authorized best judgment).

- **How much a hitter's own platoon split counts is fitted per save, only around the league norm** (`platoon-1`): where his platoon
  ratings are not visible, his split is shrunk toward the league's split for his hand by a K chosen inside each rolling origin and
  judged by the detector with its policy unchanged (the 1% minimum suits it: false adoption at most 1.0% over a simulated lifetime,
  including a true excess of 0.97%; a league twice as individual as assumed is adopted 99.5% of the time). Around his ratings, the
  K and the rating weight stay the provisional starting values until a save can check ratings as a forecast (cycle 4). On the
  Arizona import the starting K held up; a hitter's own past split predicts his next one no better than the league norm.
- **The league's own left-handed share is derived, never assumed.** `DEFAULT_LEFT_SHARE` is deleted; without the share and without
  his own record, a read states no cost (D-018).
- **The platoon margins are policy on a cost scale**, not "standard deviations of the effect" (their old rationale).
- **The leverage cut-offs are policy on the league's own leverage scale** (amends D-038's "cut-offs on the league's own
  distribution" and their `calibrated` stamp): rescaled only when the league's mean leverage is off 1.0 by more than 5%.
- **"Throws multiple innings" and "a long man" are two numbers** (amends D-038, D-042). The first stays policy (1.6 innings an
  appearance). The long-man line is a MEASUREMENT of the league as it stands: the innings per appearance of its longest-working 15%
  of relievers this season, served as measured (no pull toward 1.6, so what is checked is what is served) when the same quantile
  drawn from half the clubs, steadily across halvings, and from the first half of the season leaves about 15% of the rest at or above
  it; under 1.6 it stays 1.6 with its own reason ("this league's relievers rarely work multiple innings"). A measurement that does
  not hold up keeps the line in force and the standards measured under it (never a flip back to 1.6 on one import). The season
  split counts the same appearances as the line, starts included. It is measured with the reliever standards and recorded with them
  (`standards-2`), so the tiers and the standards measured on them are in force together or not at all; a `standards-1` row reads as
  measured under 1.6 until a `standards-2` row exists. On the Arizona import (whose game works relievers about a quarter longer than
  the real seasons it imported) it is 1.73: 15 relievers stop being long men, two strong flags appear and one disappears, "crowded:
  long men" fires on 3 clubs instead of 6, and Arizona's Joe Ross becomes a low-leverage arm on watch.
- **An unknown usual split for his hand is never zero** (review, D-018): the read states it is not established and draws no verdict.
- **No reader holds a default:** the platoon weights and the bullpen lines are required arguments, resolved once per request with
  the other yardsticks (`tests/platoonBullpenInForce.test.ts`). The minimum appearances, the deployment gap, the credible-arm line
  and the crowding counts stay policy.

**Amended 2026-09-25 (per-save calibration, cycle 4: the tools model, the blend and the ceiling lines; CALIBRATION.md section 15).**
Every item is the supervisor's call, approved by the owner 2026-09-25.

- **Knowing a player's tools never makes his results count more.** The results-against-tools blend was K × (1 − information), which
  points the wrong way. It is now K × a tools weight of at least 1 (`ResultsParams.toolsWeight`; `DEFENSE_TOOLS_WEIGHT` and
  `RUNNING_TOOLS_WEIGHT` for the glove and running). The starting weight is 1, K alone: Player Value's owner-approved rule that
  same-time ratings pull only by their own weight. `TOOLS_INFORMATION`, `DEFENSE_INFORMATION` and `RUNNING_INFORMATION` are gone.
- **"Too early to judge" and "a firm read" read the results' own trust, never the blend.** Each keeps the sample it meant before
  (too early under 161.5 PA / 301.5 BF / 215.4 BF; firm from 450 PA / 840 BF / 600 BF), through one named line each; nothing
  compares trust with a bare number (review finding B1).
- **Ratings are checked as a forecast only on forward cases.** A forward case is the ratings stored before a season against that
  season (`ratingsForward.ts`, neutral). The tools model's bat slopes and the hitters' tools weight are fitted per save (`tools-1`),
  judged by the detector unchanged, and passed as the params in force (`ToolsParams`, one reader for MLB Operations and the Lineup
  page).
  - A save needs 5 forward seasons. The Arizona import has 0 (its one snapshot is dated at its own export), so the starting values
    serve and say why.
  - A same-season engine check is reported and never decides.
  - Player Value's same-time mapping is not reused (a different target, and MLB Operations does not import Player Value); the METHOD
    is shared through the neutral layer and the detector.
- **Rating snapshots keep a hitter's split and running ratings** (12 nullable columns, added when absent). Without them the platoon
  rating weight, the K around the ratings and the running slopes could never be checked; they stay the provisional starting values
  until forward seasons exist.
- **The line a tool must move to be named is derived:** half the league's peers' spread (policy share × the league's spread).
- **Player Development's ceiling lines are a measurement of the league at each import** (D-050 amendment below). This is the first
  per-save calibration of Player Development: the fit changes a number it uses and nothing its judgments depend on.
- **Minor-league stat history is in the export** (a correction). The farm's sample constants are fittable per save and not yet
  fitted (ROADMAP). `DEVELOPMENT_AGE` and `PROJECTION_REALIZED_UNDER` stay provisional: a development path needs snapshot pairs a
  season apart, and the save has none.
- **On the Arizona import:**
  - Roster-review flags are unchanged in number (21), but 15 holders change: the working estimate leans less on results, by 0.11 for
    position players and 0.04 to 0.05 for pitchers.
  - Arizona's findings are unchanged.
  - The ceiling lines measure equal to the starting lines, so no tier moves.

## D-054 — Charting library

**Status:** Accepted: owner approved adopting a charting dependency (2026-09-23); library choice per the evaluation.
**Implementation:** Partial. visx (`@visx/shape`, `@visx/group`, 4.0.0, MIT) draws the player card's production
cone (`src/ProductionCone.tsx`, PLAYER_VALUE.md Part 8); `src/chartTheme.ts` holds the shared conventions;
`tests/productionCone.test.ts` covers the geometry, a server-side render and the theme tokens. No other chart
exists yet.

Pennant had no chart library; the owner plans more statistical analysis across the application, so the library is
chosen as infrastructure, not for one chart. Evaluated on 2026-09-23 against npm metadata and a measured build:

| Criterion | visx 4.0.0 | Observable Plot 0.6.17 | Recharts 3.10.1 | ECharts 6.1.0 | Nivo 0.99.0 |
|---|---|---|---|---|---|
| License | MIT | ISC | MIT | Apache-2.0 (outside MIT/ISC/BSD) | MIT |
| Maintenance | 4.0.0 on 2026-06-11 | last release 2025-02-14 | 3.10.1 on 2026-07-25, canaries weekly | 6.1.0 on 2026-05-19 | last release 2025-05-23 |
| React 18, TypeScript | peer React 18/19, typed | framework-free, typed; imperative DOM in an effect | peer React 16–19, typed | wrapper needed, typed | peer React 16–19, typed |
| Offline, Electron | bundled, no runtime fetch | bundled (all of d3 7) | bundled | bundled | bundled |
| Bundle | +6.4 kB gzip for the whole cone feature (measured) | d3 7 plus Plot, 1.5 MB unpacked | Redux Toolkit, Immer, react-redux, es-toolkit | large (zrender) | react-spring and one package per chart |
| Theming by CSS variables | SVG elements take `var(--…)` directly | style strings, less direct | SVG, props take `var(--…)` | theme object; canvas by default, which reads no CSS variables | theme object, not CSS |
| Statistical expressiveness | areas with y0/y1, lines, shapes, `@visx/stats` box and violin; density, bins, regression and small multiples composed from d3 (vendored) | the richest: areaY y1/y2, density, bin, linear regression, window smoothing, facets, tips | area ranges, lines, error bars; no density or regression | rich | moderate |
| Interaction, accessibility | own DOM: `role="img"` summaries, focusable HTML controls | pointer tips, ARIA attributes; no keyboard focus | built-in keyboard layer, tooltips | aria description generator; canvas marks are not focusable | tooltips, some ARIA |
| Testability in Vitest (node, no jsdom) | `renderToStaticMarkup` works | needs a DOM implementation | fixed sizes render; `ResponsiveContainer` needs a DOM | server-side SVG rendering exists | responsive wrappers need a DOM |

**The pick is visx.** It is React components over SVG, so a chart is ordinary JSX whose fills and strokes are the
theme's CSS variables, it renders on the server for tests, and it imports package by package, so a chart pays only
for what it uses. It is the lowest level of the candidates: the chart's geometry is written as a pure function
beside it, which is where Pennant wants it anyway (testable, and cheap to move to another library). Observable Plot
is the most expressive statistically and was the close second; it was set aside for its imperative DOM (it needs a
DOM in tests and sits outside React's tree for focus and events) and a release cadence that has slowed (last release
February 2025). A statistical transform Plot would give for free (a kernel density, a regression line) is written as
a pure helper over d3, which visx vendors. Recharts brings a state library and fixed chart shapes; ECharts is outside
the allowed licenses and draws to canvas; Nivo's releases stopped in May 2025 and it themes through an object, not CSS.

**Conventions for every chart:**

- **Theme tokens only.** Colours come from `CHART_COLOR` in `src/chartTheme.ts` (`--text`, `--muted`, `--border`,
  `--panel`, `--accent`), never a literal colour, so every club's palette and both modes reach the chart. The test
  checks each token is one `derivePalette` sets in both modes; `npm run check:theme` keeps checking the palette itself.
- **SVG, drawn from a pure geometry module.** A chart's layout (domain, ticks, positions, which label length fits) is
  a pure function with its own tests; the component only draws it. Import only the visx packages a chart needs:
  `@visx/axis` pulls `@visx/text` and a CSS-calc evaluator (about 17 kB) and `@visx/scale` d3's time and colour
  modules (about 30 kB), so the cone uses neither; add them when a chart needs what they do.
- **The card's look.** Charts reuse the page's type, section headers and popups (`.chart-pop` shares `.tip-pop`);
  no chart chrome of their own. Marks follow the dataviz rules: 2px lines, markers with a surface ring, washes for
  bands, hairline solid gridlines, text in text tokens, never in the data colour.
- **Accessibility.** The SVG is `role="img"` with a sentence-length summary as its accessible name; each data point
  that has detail is a focusable HTML control over the chart showing the same detail on focus as on hover; a visually
  hidden table carries every value.
- **Presentation only.** A chart draws what the API served and computes nothing about the player (D-001, D-008).

Consequences: `@visx/group` and `@visx/shape` are dev dependencies (the frontend is bundled, like React). The
production bundle grew by 18.7 kB (6.4 kB gzip: 518.4 to 537.1 kB, 149.7 to 156.1 kB gzip) for the cone, its geometry, the theme module and their styles.

## D-055 — Pennant for Mac: a native SwiftUI client over the same server, run as a sidecar

**Status:** Accepted in direction by the owner (2026-09-25); drafted at milestone N0, and its details settle in the milestone
that builds each part. **Implementation:** Not started. Design: [SWIFTUI_REBUILD.md](SWIFTUI_REBUILD.md). Refines D-008
("Electron embeds the same server and UI") for the Mac app; D-054 governs the React UI until cutover.

The owner asked for Pennant to feel like a native Mac app, deep but approachable, and chose a full SwiftUI rebuild over
restyling the web UI. The server is Pennant's judgment (every doctrine boundary, every specialist, the calibration work), so
only the part the GM sees is rebuilt.

- **One domain server; the Swift app renders and never judges.** The existing TypeScript server runs unchanged in doctrine
  as a Node sidecar inside the app bundle (`Contents/Helpers`, `Contents/Resources/server`), on `127.0.0.1` at a random
  port with a bearer token per launch. The Swift app lays out, formats served numbers, sorts, charts and integrates with
  macOS. It holds no baseball threshold, computes no ranking and writes no sentence beyond structural labels (D-001, D-008,
  D-056). A number it shows is a number the server served.
- **Liquid Glass on the controls layer only**: sidebar, toolbar, inspector, popovers, sheets and menus. Content is opaque.
  Never glass on glass or on content. Colour is never the only signal.
- **macOS 26 is the minimum**, Apple Silicon only. An API new in macOS 27 is used only behind `#available`, with a macOS 26
  path that still reads well. Distribution is Developer ID with notarization, **without the App Sandbox** (a sandboxed Node
  child could not read arbitrary OOTP save folders).
- **The same data folder as the Electron app** (`~/Library/Application Support/ootp-front-office`, the D-049 hold). Server
  changes during the rebuild are **additive only**: new tables and files, nothing existing altered. A data-folder lock
  (`server.lock`), taken by both the Electron build and the sidecar, stops the two apps writing the same databases at once.
  The first run of the Mac app on a data folder backs up `history.db`, `settings.json`, `config.json` and
  `credentials.json` to `backups/pre-swiftui-<date>/`.
- **Identities.** Development builds are `com.dakotawise.pennant.dev`; the release app keeps D-049's
  `com.dakotawise.pennant` (no Electron installer was ever published). The npm `name`, `OOTP_FO_*` and `data/` holds are
  unchanged.
- **The restore point** is the annotated tag `pre-swiftui` and the branch `archive/electron-react`, both at `87934cf` and
  pushed to `origin` (created 2026-09-25 with the owner's approval). All work is on `feature/swiftui`, with milestone PRs
  into it; `main` keeps taking server-only work. The rollback procedure is in DEVELOPMENT.md.
- **Retirement at cutover.** The React UI and Electron keep working on the branch until the last PR, which deletes `src/`,
  `electron/`, the web tests and the web dependencies, and is a single revert away. It merges to `main` only with the
  owner's approval.

## D-056 — The presentation contract: the server writes every sentence

**Status:** Accepted in direction by the owner (2026-09-25); drafted at N0. **Implementation:** Not started (milestones N2
and N4, then per department). Design: SWIFTUI_REBUILD.md section 4.

About a quarter of the prose the GM reads is authored in React today (label maps, word builders, the glossary, the stat
catalog). Two clients cannot be allowed to disagree, and the plain-language rule (AGENTS.md "Writing for the GM") must be
enforced once.

- **Every visible sentence is authored on the server**, as a `Claim` (the line, a help tag of at most about 75
  characters, an optional served value with its range and display string, a tone, an optional stated league place, and its
  basis: because, source, not known, would change if, the philosophy's lean beside the neutral reading, and how the number
  is called: calibrated, provisional, policy or unknown, D-041), a `Row` of `Cell`s for tables, and `Target` links.
- **Show the basis moves into the payload.** A claim with no basis is a defect, and "not known" is a list of sentences,
  never an empty field read as "nothing missing" (D-018). The lean is explicit or `null`, never implied by absence.
- **Tables arrive ready to show**: display strings, raw sort keys (null is unknown and sorts last in both directions), and
  claims where a cell has a basis. The client ports only the unknown-last comparator (its cases shared in
  `contract/fixtures/sort-cases.json`, run by Vitest and Swift Testing), number formatting and chart geometry.
- **Everything new is under `/api/v2/`**; the old routes serve the React app until cutover.
- **The schema is generated from the TypeScript types** into a committed `contract/openapi.json` (OpenAPI 3.1), and the
  Swift client is generated from it. Closed string unions become **open enums**, so an older app never fails on a new
  code. OOTP game dates are a `GameDate` string with no date format, because they are unpadded (compare them only through
  `parseGameDate`).
- **Tests hold it**: the committed spec equals a fresh build; every route is in the spec and back; every v2 response
  against the synthetic save validates; and every `text`, `hint` and `display` string passes one consolidated banned-jargon
  list (`tests/bannedJargon.ts`, replacing the per-page copies).

## D-057 — The Club Profile, the roster map and the horizon: stated places, no composite score

**Status:** Accepted in direction by the owner (2026-09-25); drafted at N0. **Implementation:** Not started (milestone N6).
Design: SWIFTUI_REBUILD.md sections 3.4 and 3.6.

The Morning Report answers "where are we, what are we good at, what are we bad at, what needs me" with facts and stated
places, never a thin prediction.

- **Objective league places.** Each dimension (scoring runs, preventing runs, on base, power, rotation, bullpen, defensive
  efficiency, baserunning, recent against season) is a place among the league's clubs from objective team statistics,
  with ties stated. A club missing the statistic is not placed and is not counted in "of N".
- **Policy lines, stamped as policy (D-041).** A strength is the top fifth and a weakness the bottom fifth. Before 20 games
  a dimension reads "too early" instead of a strength or weakness.
- **Player Value positional places** on the roster map follow the D-052 amendment of 2026-09-25: a place, its overlap
  count and its basis; an unvalued holder is never placed.
- **No composite score.** Dimensions are never summed or weighted into a club grade, and positions are never combined into
  one.
- **The horizon** (position × the next three seasons) shows who is controlled and how, from Player Rights and Player Value.
  A prospect sits in a pipeline lane with his readiness range from Player Development and is **never placed in a season**:
  no arrival year is invented.

## D-058 — Pennant remembers: snapshots, the GM's desk and follows record attention, never transactions

**Status:** Accepted in direction by the owner (2026-09-25); drafted at N0. **Implementation:** Not started (milestone N7).

- **Report and standings snapshots** are kept per import in `history.db` (new tables, D-009 and D-055's additive rule), so
  "what changed since the last export" compares two exports' served figures. A difference says what changed, never which
  transaction did it (D-020).
- **The GM's desk** gathers the items to decide from every department, each naming the department and the staff member who
  raised it, ordered by the department's stated severity. Its statuses (Open, Reviewed, Deferred until…, Handled in OOTP)
  record the GM's attention. "Handled in OOTP" asserts nothing about the save: Pennant never writes to OOTP (D-004), and the
  next export is what says whether anything changed.
- **Following** covers clubs and players. The watchlist is **copied** into it, not moved, so the Electron app keeps its own.

## D-059 — Around the League: a wire in the log's own words, and club reports under the same fog of war

**Status:** Accepted in direction by the owner (2026-09-25); drafted at N0. **Implementation:** Not started (milestone N7).

- **Wire sources and wording (D-020).** An entry from OOTP's transaction log says what the log says. An entry from a
  snapshot difference says the state changed ("now on the injured list", "no longer on the 40-man") and never names a
  transaction it cannot see.
- **Stated ordering.** The wire orders by date, followed clubs first when asked; it is never ranked by a hidden importance.
- **A club report for any club** uses the same specialists and the same fog of war as our own: another club's players are
  read through our organization's scouting (`scoutedEvidence.ts`), never OOTP's true ratings, and what our scouts cannot see
  about them is said.

## D-060 — The landing page shows no postseason odds, deadline posture or window labels

**Status:** Accepted (owner, 2026-09-25). **Implementation:** Not started (milestones N4 and N6).

The owner found the postseason odds and the buy/hold/sell posture (`server/posture.ts`, a two-club Pythagorean race against
a provisional rival) weak and off-mission. The Morning Report, the Club Profile and the department cards answer "where are
we" with objective facts only: record, standings place and games back, run differential, streak, next game and the
deadline date. Neither the odds, the posture nor the season-window labels are headlined there, and the landing payload
does not import them (a boundary test). They appear only in League Office standings, labelled with their basis, until
ROADMAP "Playoff odds from the roster" replaces them.
